//! Sandbox 安全执行命令
//!
//! 提供受限的命令执行能力，包含安全校验、超时控制和工作目录限制

use crate::sandbox::validator::{CommandValidator, ValidationResult};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::AppHandle;
use tauri::Manager;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::time::{timeout, Duration};
use std::sync::Mutex;

use lazy_static::lazy_static;

lazy_static! {
  // Waiting for a child never holds this lock. Windows keeps a Job handle;
  // Unix uses the pid as a process-group id.
  static ref RUNNING_SHELLS: Mutex<HashMap<String, ManagedProcess>> =
    Mutex::new(HashMap::new());
  /// Long-running processes started by `start_shell_process`, keyed by the id the
  /// agent uses to read logs and stop them.
  static ref MANAGED_SHELLS: Mutex<HashMap<String, std::sync::Arc<ManagedShell>>> =
    Mutex::new(HashMap::new());
}

/// Bytes kept per stream for a managed process. Only the tail is retained: for a
/// dev server or a build, the most recent lines are what matters.
const MANAGED_LOG_CAP: usize = 256 * 1024;
/// Concurrent running managed processes allowed per app instance.
const MANAGED_PROCESS_LIMIT: usize = 4;
/// Finished entries kept so their last output stays readable.
const MANAGED_FINISHED_LIMIT: usize = 16;
const MANAGED_LOG_DEFAULT_LIMIT: usize = 8 * 1024;
const MANAGED_LOG_MAX_LIMIT: usize = 16 * 1024;

/// Bounded tail buffer: keeps the newest bytes and counts everything seen.
struct TailBuffer {
  data: VecDeque<u8>,
  total: usize,
}

impl TailBuffer {
  fn new() -> Self {
    Self { data: VecDeque::with_capacity(8192), total: 0 }
  }

  fn push(&mut self, chunk: &[u8]) {
    self.total += chunk.len();
    for byte in chunk {
      self.data.push_back(*byte);
    }
    while self.data.len() > MANAGED_LOG_CAP {
      self.data.pop_front();
    }
  }

  /// Last `limit` bytes, plus how many bytes were dropped from the front.
  fn tail(&self, limit: usize) -> (String, usize) {
    let limit = limit.min(MANAGED_LOG_MAX_LIMIT).max(1);
    let take = limit.min(self.data.len());
    let start = self.data.len() - take;
    let bytes: Vec<u8> = self.data.iter().skip(start).copied().collect();
    // Dropped = everything the caller asked for but we no longer hold.
    let dropped = self.total.saturating_sub(take);
    (String::from_utf8_lossy(&bytes).into_owned(), dropped)
  }
}

struct ManagedShellState {
  stdout: TailBuffer,
  stderr: TailBuffer,
  running: bool,
  exit_code: Option<i32>,
}

struct ManagedShell {
  pid: u32,
  #[cfg(windows)]
  job: std::sync::Arc<JobHandle>,
  command: String,
  working_dir: String,
  started_at: i64,
  state: std::sync::Arc<Mutex<ManagedShellState>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StartedShell {
  pub execution_id: String,
  pub pid: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ManagedShellOutput {
  pub execution_id: String,
  pub running: bool,
  pub exit_code: Option<i32>,
  pub stdout: String,
  pub stderr: String,
  pub stdout_bytes: usize,
  pub stderr_bytes: usize,
  /// Bytes dropped because the retained window is bounded.
  pub stdout_dropped: usize,
  pub stderr_dropped: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ManagedShellSummary {
  pub execution_id: String,
  pub pid: u32,
  pub command: String,
  pub working_dir: String,
  pub running: bool,
  pub exit_code: Option<i32>,
  pub started_at: i64,
  pub stdout_bytes: usize,
  pub stderr_bytes: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct StoppedShell {
  pub stopped: bool,
  pub exit_code: Option<i32>,
}

/// Owns the Windows Job Object handle exactly once. Cloning the `Arc` shares
/// ownership; the handle closes when the last reference drops, so cancellation
/// and normal completion can never double-close the same handle value.
#[cfg(windows)]
struct JobHandle(isize);

#[cfg(windows)]
impl Drop for JobHandle {
  fn drop(&mut self) {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    unsafe {
      let _ = CloseHandle(HANDLE(self.0 as *mut core::ffi::c_void));
    }
  }
}

#[derive(Clone)]
struct ManagedProcess { pid: u32, #[cfg(windows)] job: std::sync::Arc<JobHandle> }

/// Shell 执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellResult {
  /// 是否成功
  pub success: bool,
  /// 退出码
  pub exit_code: i32,
  /// 标准输出
  pub stdout: String,
  /// 标准错误
  pub stderr: String,
  /// 执行耗时（毫秒）
  pub duration_ms: u64,
  /// 错误信息（如果失败）
  pub error: Option<String>,
  /// 是否因为超时被终止（此时 stdout/stderr 是终止前的输出）
  pub timed_out: bool,
}

/// 执行选项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecuteOptions {
  /// 前端传入的执行ID（用于 cancel）
  pub execution_id: Option<String>,
  /// 要执行的命令
  pub command: String,
  /// 命令参数
  #[serde(default)]
  pub args: Vec<String>,
  /// 工作目录
  pub working_dir: Option<String>,
  /// 超时时间（毫秒），默认 30000
  #[serde(default = "default_timeout")]
  pub timeout_ms: u64,
  /// 环境变量
  #[serde(default)]
  pub env: HashMap<String, String>,
  /// 最大输出大小（字节），默认 1MB
  #[serde(default = "default_max_output")]
  pub max_output_size: usize,
}

fn default_timeout() -> u64 {
  30000
}

fn default_max_output() -> usize {
  1024 * 1024 // 1MB
}

async fn kill_process_tree(process: ManagedProcess) -> std::io::Result<()> {
  if process.pid == 0 {
    return Ok(());
  }
  #[cfg(windows)]
  {
    use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
    use windows::Win32::System::JobObjects::TerminateJobObject;
    use windows::Win32::System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE};
    let job = HANDLE(process.job.0 as *mut core::ffi::c_void);
    unsafe {
      TerminateJobObject(job, 1).map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error.to_string()))?;
    }
    // Confirm the tree is actually gone before reporting success. A process
    // that already exited makes OpenProcess fail, which counts as confirmed.
    unsafe {
      if let Ok(handle) = OpenProcess(PROCESS_SYNCHRONIZE, false, process.pid) {
        let waited = WaitForSingleObject(handle, 2000);
        let _ = CloseHandle(handle);
        if waited != WAIT_OBJECT_0 {
          return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "取消后进程仍在运行（2 秒内未退出）",
          ));
        }
      }
    }
    Ok(())
  }
  #[cfg(not(windows))]
  {
    let status = Command::new("kill")
      .args(["-TERM", &format!("-{}", process.pid)])
      .status()
      .await?;
    if !status.success() { return Err(std::io::Error::new(std::io::ErrorKind::Other, "process-group TERM failed")); }
    tokio::time::sleep(Duration::from_millis(100)).await;
    let alive = Command::new("kill").args(["-0", &format!("-{}", process.pid)]).status().await?.success();
    if alive {
      let killed = Command::new("kill").args(["-KILL", &format!("-{}", process.pid)]).status().await?;
      if !killed.success() { return Err(std::io::Error::new(std::io::ErrorKind::Other, "process-group KILL failed")); }
    }
    Ok(())
  }
}

/// 取消正在运行的 shell 命令（best-effort）
#[tauri::command]
pub async fn cancel_safe_shell(execution_id: String) -> Result<bool, String> {
  let id = execution_id.trim().to_string();
  if id.is_empty() {
    return Ok(false);
  }

  let handle = {
    let mut map = RUNNING_SHELLS
      .lock()
      .map_err(|_| "RUNNING_SHELLS lock poisoned".to_string())?;
    map.remove(&id)
  };

  if let Some(process) = handle {
    kill_process_tree(process).await.map_err(|error| format!("取消进程树失败: {error}"))?;
    return Ok(true);
  }

  // The same id namespace covers background processes started by the agent, so
  // stopping a run also stops whatever it left running.
  let managed = {
    let mut map = MANAGED_SHELLS
      .lock()
      .map_err(|_| "MANAGED_SHELLS lock poisoned".to_string())?;
    map.remove(&id)
  };
  if let Some(entry) = managed {
    let running = entry.state.lock().map(|state| state.running).unwrap_or(false);
    if running {
      kill_process_tree(ManagedProcess { pid: entry.pid, #[cfg(windows)] job: entry.job.clone() })
        .await
        .map_err(|error| format!("取消后台进程失败: {error}"))?;
    }
    return Ok(true);
  }

  Ok(false)
}

/// 安全执行 shell 命令
///
/// 启动一个后台进程（dev server、watch、长构建）。
///
/// 复用 blocking 执行相同的安全校验、Job Object 归属与输出排空，但不等待退出：
/// 输出进入有界尾部缓冲，由 `read_shell_process` 增量读取，`stop_shell_process` 终止。
#[tauri::command]
pub async fn start_shell_process(
  app: AppHandle,
  options: ExecuteOptions,
) -> Result<StartedShell, String> {
  let app_data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
  start_managed_process(options, app_data_dir).await
}

/// Spawn a managed process.  Kept separate from the command so the lifecycle can
/// be exercised with a real child process in tests.
async fn start_managed_process(
  options: ExecuteOptions,
  app_data_dir: PathBuf,
) -> Result<StartedShell, String> {
  let execution_id = options
    .execution_id
    .clone()
    .unwrap_or_default()
    .trim()
    .to_string();
  if execution_id.is_empty() {
    return Err("execution_id is required for a managed process".to_string());
  }

  {
    let map = MANAGED_SHELLS.lock().map_err(|_| "MANAGED_SHELLS lock poisoned".to_string())?;
    if map.contains_key(&execution_id) {
      return Err(format!("进程 {execution_id} 已存在"));
    }
    let running = map.values().filter(|entry| {
      entry.state.lock().map(|state| state.running).unwrap_or(false)
    }).count();
    if running >= MANAGED_PROCESS_LIMIT {
      return Err(format!(
        "已达后台进程上限（{MANAGED_PROCESS_LIMIT}），先停止一个再启动新的"
      ));
    }
  }

  let validator = CommandValidator::new();

  let full_command = if options.args.is_empty() {
    options.command.clone()
  } else {
    format!("{} {}", options.command, options.args.join(" "))
  };
  let cmd_result = validator.validate_command(&full_command);
  if !cmd_result.valid {
    return Err(format!(
      "命令安全校验失败: {}",
      cmd_result.reason.unwrap_or_else(|| "未知原因".to_string())
    ));
  }

  let working_dir = match options.working_dir.clone().filter(|dir| !dir.trim().is_empty()) {
    Some(dir) => {
      let path_result = validator.validate_path(&dir);
      if !path_result.valid {
        return Err(format!(
          "工作目录校验失败: {}",
          path_result.reason.unwrap_or_else(|| "未知原因".to_string())
        ));
      }
      PathBuf::from(dir)
    }
    None => app_data_dir.clone(),
  };
  if !working_dir.exists() {
    tokio::fs::create_dir_all(&working_dir)
      .await
      .map_err(|e| format!("无法创建工作目录: {}", e))?;
  }

  let mut cmd = Command::new(&options.command);
  cmd.args(&options.args);
  cmd.current_dir(&working_dir);
  cmd.stdout(Stdio::piped());
  cmd.stderr(Stdio::piped());
  cmd.stdin(Stdio::null());
  for (key, value) in &options.env {
    cmd.env(key, value);
  }
  cmd.env("HOME", app_data_dir.to_string_lossy().to_string());
  cmd.env("USERPROFILE", app_data_dir.to_string_lossy().to_string());
  #[cfg(windows)]
  {
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
  }
  #[cfg(not(windows))]
  {
    cmd.process_group(0);
  }

  #[cfg(windows)]
  let job = {
    use windows::Win32::System::JobObjects::{CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE};
    let job = unsafe { CreateJobObjectW(None, None) }.map_err(|error| format!("创建 Job Object 失败: {error}"))?;
    let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    unsafe {
      SetInformationJobObject(job, JobObjectExtendedLimitInformation, &info as *const _ as *const core::ffi::c_void,
        std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32)
        .map_err(|error| format!("配置 Job Object 失败: {error}"))?;
    }
    std::sync::Arc::new(JobHandle(job.0 as isize))
  };

  let mut child = cmd.spawn().map_err(|e| format!("启动命令失败: {}", e))?;
  let pid = child.id().unwrap_or_default();

  #[cfg(windows)]
  {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::AssignProcessToJobObject;
    let raw_process = match child.raw_handle() {
      Some(raw) => raw,
      None => {
        let _ = child.kill().await;
        return Err("无法获取子进程句柄".to_string());
      }
    };
    if let Err(error) =
      unsafe { AssignProcessToJobObject(HANDLE(job.0 as *mut core::ffi::c_void), HANDLE(raw_process)) }
    {
      let _ = child.kill().await;
      let _ = child.wait().await;
      return Err(format!("绑定 Job Object 失败: {error}"));
    }
  }

  let state = std::sync::Arc::new(Mutex::new(ManagedShellState {
    stdout: TailBuffer::new(),
    stderr: TailBuffer::new(),
    running: true,
    exit_code: None,
  }));

  if let Some(reader) = child.stdout.take() {
    let state = state.clone();
    tokio::spawn(async move {
      let mut reader = reader;
      let mut buffer = [0_u8; 8192];
      while let Ok(count) = reader.read(&mut buffer).await {
        if count == 0 { break; }
        if let Ok(mut guard) = state.lock() {
          guard.stdout.push(&buffer[..count]);
        }
      }
    });
  }
  if let Some(reader) = child.stderr.take() {
    let state = state.clone();
    tokio::spawn(async move {
      let mut reader = reader;
      let mut buffer = [0_u8; 8192];
      while let Ok(count) = reader.read(&mut buffer).await {
        if count == 0 { break; }
        if let Ok(mut guard) = state.lock() {
          guard.stderr.push(&buffer[..count]);
        }
      }
    });
  }

  let wait_state = state.clone();
  tokio::spawn(async move {
    let status = child.wait().await;
    if let Ok(mut guard) = wait_state.lock() {
      guard.running = false;
      guard.exit_code = status.ok().and_then(|s| s.code());
    }
  });

  let entry = std::sync::Arc::new(ManagedShell {
    pid,
    #[cfg(windows)]
    job,
    command: full_command,
    working_dir: working_dir.to_string_lossy().to_string(),
    started_at: now_ms(),
    state,
  });

  {
    let mut map = MANAGED_SHELLS.lock().map_err(|_| "MANAGED_SHELLS lock poisoned".to_string())?;
    // Keep finished entries readable, but bound how many we retain.
    let finished: Vec<String> = map
      .iter()
      .filter(|(_, entry)| entry.state.lock().map(|state| !state.running).unwrap_or(false))
      .map(|(id, _)| id.clone())
      .collect();
    while map.len() >= MANAGED_FINISHED_LIMIT && !finished.is_empty() {
      let oldest = finished
        .iter()
        .min_by_key(|id| map.get(*id).map(|entry| entry.started_at).unwrap_or(0))
        .cloned();
      match oldest {
        Some(id) => { map.remove(&id); }
        None => break,
      }
    }
    map.insert(execution_id.clone(), entry);
  }

  log::info!("[Sandbox] Started managed process {} (pid {})", execution_id, pid);
  Ok(StartedShell { execution_id, pid })
}

#[tauri::command]
pub async fn read_shell_process(execution_id: String, limit: Option<usize>) -> Result<ManagedShellOutput, String> {
  let entry = {
    let map = MANAGED_SHELLS.lock().map_err(|_| "MANAGED_SHELLS lock poisoned".to_string())?;
    map.get(execution_id.trim()).cloned()
  }
  .ok_or_else(|| format!("未知的后台进程: {execution_id}"))?;

  let limit = limit.unwrap_or(MANAGED_LOG_DEFAULT_LIMIT);
  let state = entry.state.lock().map_err(|_| "managed process lock poisoned".to_string())?;
  let (stdout, stdout_dropped) = state.stdout.tail(limit);
  let (stderr, stderr_dropped) = state.stderr.tail(limit);
  Ok(ManagedShellOutput {
    execution_id: execution_id.trim().to_string(),
    running: state.running,
    exit_code: state.exit_code,
    stdout,
    stderr,
    stdout_bytes: state.stdout.total,
    stderr_bytes: state.stderr.total,
    stdout_dropped,
    stderr_dropped,
  })
}

#[tauri::command]
pub async fn stop_shell_process(execution_id: String) -> Result<StoppedShell, String> {
  let id = execution_id.trim().to_string();
  let entry = {
    let mut map = MANAGED_SHELLS.lock().map_err(|_| "MANAGED_SHELLS lock poisoned".to_string())?;
    map.remove(&id)
  };
  let Some(entry) = entry else {
    return Ok(StoppedShell { stopped: false, exit_code: None });
  };
  let running = entry.state.lock().map(|state| state.running).unwrap_or(false);
  let exit_code = entry.state.lock().ok().and_then(|state| state.exit_code);
  if !running {
    return Ok(StoppedShell { stopped: false, exit_code });
  }
  kill_process_tree(ManagedProcess { pid: entry.pid, #[cfg(windows)] job: entry.job.clone() })
    .await
    .map_err(|error| format!("停止后台进程失败: {error}"))?;
  Ok(StoppedShell { stopped: true, exit_code })
}

#[tauri::command]
pub async fn list_shell_processes() -> Result<Vec<ManagedShellSummary>, String> {
  let map = MANAGED_SHELLS.lock().map_err(|_| "MANAGED_SHELLS lock poisoned".to_string())?;
  let mut out: Vec<ManagedShellSummary> = Vec::with_capacity(map.len());
  for (id, entry) in map.iter() {
    let state = entry.state.lock().map_err(|_| "managed process lock poisoned".to_string())?;
    out.push(ManagedShellSummary {
      execution_id: id.clone(),
      pid: entry.pid,
      command: entry.command.clone(),
      working_dir: entry.working_dir.clone(),
      running: state.running,
      exit_code: state.exit_code,
      started_at: entry.started_at,
      stdout_bytes: state.stdout.total,
      stderr_bytes: state.stderr.total,
    });
  }
  out.sort_by_key(|entry| entry.started_at);
  Ok(out)
}

fn now_ms() -> i64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0)
}

/// 安全执行 shell 命令
///
/// 包含以下安全措施：
/// 1. 命令安全校验（阻止危险命令）
/// 2. 工作目录限制（仅允许访问应用数据目录）
/// 3. 执行超时控制
/// 4. 输出大小限制
#[tauri::command]
pub async fn run_safe_shell(
  app: AppHandle,
  options: ExecuteOptions,
) -> Result<ShellResult, String> {
  let start_time = std::time::Instant::now();

  // 获取应用数据目录作为默认允许目录
  let app_data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("无法获取应用数据目录: {}", e))?;

  // Whether a command may run is the user's decision (see the approval card);
  // the sandbox keeps only the destructive-pattern backstop.  The allowlist that
  // used to live here also rejected the shells themselves (cmd.exe, powershell)
  // and confined the working directory to the app data folder.
  let validator = CommandValidator::new();

  let full_command = if options.args.is_empty() {
    options.command.clone()
  } else {
    format!("{} {}", options.command, options.args.join(" "))
  };

  // 校验命令安全性
  let cmd_result = validator.validate_command(&full_command);
  if !cmd_result.valid {
    return Err(format!(
      "命令安全校验失败: {}",
      cmd_result.reason.unwrap_or_else(|| "未知原因".to_string())
    ));
  }

  // 确定工作目录
  let working_dir = if let Some(ref dir) = options.working_dir {
    // 校验工作目录
    let path_result = validator.validate_path(dir);
    if !path_result.valid {
      return Err(format!(
        "工作目录校验失败: {}",
        path_result.reason.unwrap_or_else(|| "未知原因".to_string())
      ));
    }
    PathBuf::from(dir)
  } else {
    app_data_dir.clone()
  };

  // 确保工作目录存在
  if !working_dir.exists() {
    tokio::fs::create_dir_all(&working_dir)
      .await
      .map_err(|e| format!("无法创建工作目录: {}", e))?;
  }

  // 构建命令
  let mut cmd = Command::new(&options.command);
  cmd.args(&options.args);
  cmd.current_dir(&working_dir);
  cmd.stdout(Stdio::piped());
  cmd.stderr(Stdio::piped());
  cmd.stdin(Stdio::null()); // 禁止输入

  // 设置环境变量
  for (key, value) in &options.env {
    cmd.env(key, value);
  }

  // 设置安全相关的环境变量
  cmd.env("HOME", app_data_dir.to_string_lossy().to_string());
  cmd.env("USERPROFILE", app_data_dir.to_string_lossy().to_string());

  // Windows 特定：隐藏窗口
  #[cfg(windows)]
  {
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
  }
  #[cfg(not(windows))]
  {
    cmd.process_group(0);
  }

  log::info!(
    "[Sandbox] Executing command: {} in {:?}",
    options.command,
    working_dir
  );
  
  // Debug log: 记录完整的命令和参数
  log::info!(
    "[Sandbox] DEBUG - command: '{}', args: {:?}, args_count: {}",
    options.command,
    options.args,
    options.args.len()
  );
  // 如果是 cmd.exe，特别记录第四个参数（实际命令）
  if options.command.to_lowercase().contains("cmd") && options.args.len() >= 4 {
    log::info!(
      "[Sandbox] DEBUG - cmd.exe actual command (arg[3]): '{}'",
      options.args.get(3).unwrap_or(&String::new())
    );
  }

  // The Job Object must exist before the process does, so a failed bind can
  // never leave an unmanaged child running outside the job.
  #[cfg(windows)]
  let job = {
    use windows::Win32::System::JobObjects::{CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE};
    let job = unsafe { CreateJobObjectW(None, None) }.map_err(|error| format!("创建 Job Object 失败: {error}"))?;
    let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    unsafe {
      SetInformationJobObject(job, JobObjectExtendedLimitInformation, &info as *const _ as *const core::ffi::c_void,
        std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32)
        .map_err(|error| format!("配置 Job Object 失败: {error}"))?;
    }
    std::sync::Arc::new(JobHandle(job.0 as isize))
  };

  // 启动进程
  let mut child = cmd.spawn().map_err(|e| format!("启动命令失败: {}", e))?;
  let pid = child.id().unwrap_or_default();

  #[cfg(windows)]
  {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::AssignProcessToJobObject;
    let raw_process = match child.raw_handle() {
      Some(raw) => raw,
      None => {
        let _ = child.kill().await;
        return Err("无法获取子进程句柄".to_string());
      }
    };
    if let Err(error) =
      unsafe { AssignProcessToJobObject(HANDLE(job.0 as *mut core::ffi::c_void), HANDLE(raw_process)) }
    {
      // Never report a started command that escaped the job: kill it first.
      let _ = child.kill().await;
      let _ = child.wait().await;
      return Err(format!("绑定 Job Object 失败: {error}"));
    }
  }

  // 注册到全局 map（用于 cancel）
  let exec_id = options.execution_id.clone().unwrap_or_default();
  if !exec_id.trim().is_empty() {
    if let Ok(mut map) = RUNNING_SHELLS.lock() {
      map.insert(exec_id.clone(), ManagedProcess { pid, #[cfg(windows)] job: job.clone() });
    }
  }

  // 获取输出流
  let stdout = child.stdout.take();
  let stderr = child.stderr.take();

  // 异步读取输出
  let max_output = options.max_output_size;

  let stdout_handle = tokio::spawn(drain_output(stdout, max_output));
  let stderr_handle = tokio::spawn(drain_output(stderr, max_output));

  // 等待命令完成（带超时）
  let timeout_duration = Duration::from_millis(options.timeout_ms);
  let wait_result = timeout(timeout_duration, async {
    child.wait().await
  })
  .await;

  let duration_ms = start_time.elapsed().as_millis() as u64;

  let result = match wait_result {
    Ok(Ok(status)) => {
      let stdout = stdout_handle.await.unwrap_or_default();
      let stderr = stderr_handle.await.unwrap_or_default();
      let exit_code = status.code().unwrap_or(-1);

      log::info!(
        "[Sandbox] Command completed with exit code {} in {}ms",
        exit_code,
        duration_ms
      );

      Ok(ShellResult {
        success: status.success(),
        exit_code,
        stdout,
        stderr,
        duration_ms,
        timed_out: false,
        error: if status.success() {
          None
        } else {
          Some(format!("命令退出码: {}", exit_code))
        },
      })
    }
    Ok(Err(e)) => {
      log::error!("[Sandbox] Command failed: {}", e);
      Ok(ShellResult {
        success: false,
        exit_code: -1,
        stdout: String::new(),
        stderr: String::new(),
        duration_ms,
        timed_out: false,
        error: Some(format!("命令执行失败: {}", e)),
      })
    }
    Err(_) => {
      // Timeout: kill the tree, but keep whatever the command already printed.
      // A build or install that fails late is exactly the case where the
      // captured output is the only way to tell what happened.
      log::warn!("[Sandbox] Command timed out after {}ms", options.timeout_ms);
      let process = ManagedProcess { pid, #[cfg(windows)] job: job.clone() };
      // Report a failed tree kill as a result rather than an early return, so
      // the registry entry is always cleared and a reused pid can never be
      // cancelled by a later request.
      let kill_result = kill_process_tree(process).await;
      let stdout = stdout_handle.await.unwrap_or_default();
      let stderr = stderr_handle.await.unwrap_or_default();
      match kill_result {
        Ok(()) => {
          let _ = child.wait().await;
          Ok(ShellResult {
            success: false,
            exit_code: -1,
            stdout,
            stderr,
            duration_ms: options.timeout_ms,
            timed_out: true,
            error: Some(format!("命令执行超时 ({}ms)", options.timeout_ms)),
          })
        }
        Err(error) => Ok(ShellResult {
          success: false,
          exit_code: -1,
          stdout,
          stderr,
          duration_ms: options.timeout_ms,
          timed_out: true,
          error: Some(format!("命令超时且终止进程树失败: {error}")),
        }),
      }
    }
  };

  // 清理全局 map（无论成功/失败/超时，都尽力移除）
  if !exec_id.trim().is_empty() {
    if let Ok(mut map) = RUNNING_SHELLS.lock() {
      map.remove(&exec_id);
    }
  }

  result
}

/// 校验命令（不执行）
///
/// 用于前端预校验命令安全性
#[tauri::command]
pub fn validate_command(command: String, working_dir: Option<String>) -> ValidationResult {
  let validator = CommandValidator::new();

  // 校验命令
  let cmd_result = validator.validate_command(&command);
  if !cmd_result.valid {
    return cmd_result;
  }

  // 校验路径
  if let Some(dir) = working_dir {
    let path_result = validator.validate_path(&dir);
    if !path_result.valid {
      return path_result;
    }
  }

  ValidationResult::ok()
}

/// 检查环境
///
/// 检测 Python/Node.js 是否可用
#[tauri::command]
pub async fn check_runtime_environment(runtime: String) -> Result<RuntimeCheckResult, String> {
  let (cmd, version_arg) = match runtime.as_str() {
    "python" => {
      #[cfg(windows)]
      {
        ("python", "--version")
      }
      #[cfg(not(windows))]
      {
        ("python3", "--version")
      }
    }
    "node" => ("node", "--version"),
    _ => return Err(format!("不支持的运行时: {}", runtime)),
  };

  let mut command = Command::new(cmd);
  command.arg(version_arg);

  #[cfg(windows)]
  {
    command.creation_flags(0x08000000);
  }

  match timeout(Duration::from_secs(5), command.output()).await {
    Ok(Ok(output)) => {
      if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(RuntimeCheckResult {
          available: true,
          runtime: runtime.clone(),
          version: Some(version),
          path: Some(cmd.to_string()),
          error: None,
          install_hint: None,
          download_url: None,
        })
      } else {
        let error = String::from_utf8_lossy(&output.stderr).to_string();
        Ok(create_unavailable_result(&runtime, Some(error)))
      }
    }
    Ok(Err(e)) => Ok(create_unavailable_result(&runtime, Some(e.to_string()))),
    Err(_) => Ok(create_unavailable_result(
      &runtime,
      Some("检测超时".to_string()),
    )),
  }
}

/// 运行时检测结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeCheckResult {
  pub available: bool,
  pub runtime: String,
  pub version: Option<String>,
  pub path: Option<String>,
  pub error: Option<String>,
  pub install_hint: Option<String>,
  pub download_url: Option<String>,
}

fn create_unavailable_result(runtime: &str, error: Option<String>) -> RuntimeCheckResult {
  let (install_hint, download_url) = match runtime {
    "python" => (
      Some("请安装 Python 3.8 或更高版本".to_string()),
      Some("https://www.python.org/downloads/".to_string()),
    ),
    "node" => (
      Some("请安装 Node.js 18 或更高版本".to_string()),
      Some("https://nodejs.org/".to_string()),
    ),
    _ => (None, None),
  };

  RuntimeCheckResult {
    available: false,
    runtime: runtime.to_string(),
    version: None,
    path: None,
    error,
    install_hint,
    download_url,
  }
}

// Keep draining after the display cap. Closing a full output pipe can block or
// terminate the child; lines() also allows an unbounded single-line allocation.
async fn drain_output<R: AsyncRead + Unpin>(reader: Option<R>, limit: usize) -> String {
  let Some(mut reader) = reader else { return String::new(); };
  // Keep both ends: build and install failures print their cause last, while
  // the useful context (what was running) is at the start.
  let head_limit = limit / 2;
  let tail_limit = limit.saturating_sub(head_limit);
  let mut head: Vec<u8> = Vec::new();
  let mut tail: VecDeque<u8> = VecDeque::new();
  let mut buffer = [0_u8; 8192];
  let mut total = 0_usize;
  while let Ok(count) = reader.read(&mut buffer).await {
    if count == 0 { break; }
    total += count;
    let chunk = &buffer[..count];
    if head.len() < head_limit {
      let take = (head_limit - head.len()).min(chunk.len());
      head.extend_from_slice(&chunk[..take]);
      for byte in &chunk[take..] {
        tail.push_back(*byte);
      }
    } else {
      for byte in chunk {
        tail.push_back(*byte);
      }
    }
    while tail.len() > tail_limit {
      tail.pop_front();
    }
  }
  let head_text = String::from_utf8_lossy(&head).into_owned();
  let tail_text: String = String::from_utf8_lossy(&tail.iter().copied().collect::<Vec<u8>>()).into_owned();
  let omitted = total.saturating_sub(head_text.len() + tail_text.len());
  if omitted == 0 {
    return format!("{head_text}{tail_text}");
  }
  format!("{head_text}\n[…已省略 {omitted} 字节…]\n{tail_text}")
}

#[cfg(test)]
mod output_tests {
  use super::{drain_output, TailBuffer, MANAGED_LOG_CAP};
  use tokio::io::AsyncWriteExt;
  use tokio::time::{timeout, Duration};

  #[tokio::test]
  async fn drains_beyond_cap_without_newlines() {
    let (reader, mut writer) = tokio::io::duplex(64);
    let producer = tokio::spawn(async move {
      writer.write_all(&vec![b'x'; 100_000]).await.unwrap();
    });
    let output = timeout(Duration::from_secs(2), drain_output(Some(reader), 100)).await.unwrap();
    producer.await.unwrap();
    // Head and tail are both kept; the omitted count is reported in between.
    assert!(output.starts_with(&"x".repeat(50)), "head missing: {output:.80}");
    assert!(output.ends_with(&"x".repeat(50)), "tail missing");
    assert!(output.contains("已省略"), "omitted marker missing: {output}");
  }

  #[tokio::test]
  async fn keeps_the_tail_of_a_long_output() {
    let (reader, mut writer) = tokio::io::duplex(64);
    let producer = tokio::spawn(async move {
      writer.write_all(&vec![b'a'; 60_000]).await.unwrap();
      writer.write_all(b"\nBUILD FAILED: missing module\n").await.unwrap();
    });
    let output = timeout(Duration::from_secs(2), drain_output(Some(reader), 4000)).await.unwrap();
    producer.await.unwrap();

    assert!(output.contains("BUILD FAILED"), "the error at the end must survive truncation");
    assert!(output.len() <= 4000 + 64);
  }

  #[tokio::test]
  async fn tail_buffer_keeps_newest_bytes_and_counts_everything() {
    let mut buffer = TailBuffer::new();
    buffer.push(&vec![b'y'; MANAGED_LOG_CAP + 1024]);
    buffer.push(b"final-line");

    let (text, dropped) = buffer.tail(64);
    assert!(text.ends_with("final-line"));
    assert_eq!(buffer.total, MANAGED_LOG_CAP + 1024 + 10);
    assert!(dropped > 0, "older bytes must be reported as dropped");
  }

  #[tokio::test]
  async fn preserves_line_endings_and_utf8() {
    let data = "第一行\r\nsecond\n".as_bytes();
    assert_eq!(drain_output(Some(data), 100).await, "第一行\r\nsecond\n");
  }
}

/// Real process test: a managed child must actually be terminated, and within
/// the cancellation budget, rather than only reported as cancelled.
#[cfg(all(test, windows))]
mod tree_tests {
  use super::*;

  #[tokio::test]
  async fn terminates_a_real_process_tree_within_two_seconds() {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
      AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
      SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    let mut child = std::process::Command::new("cmd")
      .args(["/C", "ping -n 60 127.0.0.1 > nul"])
      .spawn()
      .expect("spawn a long running child");
    let job = unsafe { CreateJobObjectW(None, None) }.expect("create job object");
    let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    unsafe {
      SetInformationJobObject(
        job,
        JobObjectExtendedLimitInformation,
        &info as *const _ as *const core::ffi::c_void,
        std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
      )
      .expect("configure job object");
      AssignProcessToJobObject(job, HANDLE(child.as_raw_handle())).expect("bind child to job object");
    }

    let pid = child.id();
    let process = ManagedProcess {
      pid,
      job: std::sync::Arc::new(JobHandle(job.0 as isize)),
    };
    let started = std::time::Instant::now();
    kill_process_tree(process).await.expect("terminate the process tree");
    let elapsed = started.elapsed();
    assert!(elapsed < std::time::Duration::from_secs(2), "cancellation took {elapsed:?}");

    let status = child.wait().expect("reap the child");
    assert!(!status.success(), "a terminated process must not report success");
  }
}

/// The agent's background-process path: start, read incremental output, stop.
/// Real children, so the Job Object wiring is exercised rather than mocked.
#[cfg(test)]
mod managed_process_tests {
  use super::*;

  fn options(id: &str, command: &str, args: Vec<String>) -> ExecuteOptions {
    let mut env = HashMap::new();
    env.insert("CHATLESS_TEST".to_string(), "1".to_string());
    ExecuteOptions {
      execution_id: Some(id.to_string()),
      command: command.to_string(),
      args,
      working_dir: Some(std::env::temp_dir().to_string_lossy().to_string()),
      timeout_ms: 5_000,
      env,
      max_output_size: 1024 * 1024,
    }
  }

  async fn wait_for_line(id: &str, needle: &str) -> String {
    for _ in 0..40 {
      let output = read_shell_process(id.to_string(), Some(4096)).await.expect("read process output");
      if output.stdout.contains(needle) {
        return output.stdout;
      }
      tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("process never printed {needle}");
  }

  #[tokio::test]
  #[cfg(windows)]
  async fn reads_incremental_output_and_reports_exit() {
    let id = format!("managed-test-{}", std::process::id());
    let _ = stop_shell_process(id.clone()).await;
    let started = start_managed_process(
      options(&id, "cmd.exe", vec![
        "/C".into(),
        "echo first-line & ping -n 3 127.0.0.1 > nul & echo second-line".into(),
      ]),
      std::env::temp_dir(),
    )
    .await
    .expect("start managed process");
    assert!(started.pid > 0);

    wait_for_line(&id, "first-line").await;
    // The process finishes on its own; the entry stays readable.
    for _ in 0..40 {
      let output = read_shell_process(id.clone(), Some(4096)).await.unwrap();
      if !output.running {
        assert!(output.stdout.contains("second-line"));
        assert_eq!(output.exit_code, Some(0));
        break;
      }
      tokio::time::sleep(Duration::from_millis(100)).await;
    }

    let listed = list_shell_processes().await.expect("list processes");
    assert!(listed.iter().any(|entry| entry.execution_id == id));
    let stopped = stop_shell_process(id.clone()).await.expect("stop finished process");
    assert!(!stopped.stopped, "an exited process is not reported as stopped");
  }

  #[tokio::test]
  #[cfg(windows)]
  async fn stops_a_running_process() {
    let id = format!("managed-stop-{}", std::process::id());
    let _ = stop_shell_process(id.clone()).await;
    start_managed_process(
      options(&id, "cmd.exe", vec!["/C".into(), "ping -n 60 127.0.0.1 > nul".into()]),
      std::env::temp_dir(),
    )
    .await
    .expect("start long running process");

    let started = std::time::Instant::now();
    let stopped = stop_shell_process(id.clone()).await.expect("stop running process");
    assert!(stopped.stopped);
    assert!(started.elapsed() < Duration::from_secs(2), "stop must be prompt");

    let after = stop_shell_process(id).await.expect("second stop is a no-op");
    assert!(!after.stopped);
  }

  #[tokio::test]
  #[cfg(not(windows))]
  async fn reads_incremental_output_and_reports_exit() {
    let id = format!("managed-test-{}", std::process::id());
    let _ = stop_shell_process(id.clone()).await;
    start_managed_process(
      options(&id, "sh", vec!["-c".into(), "echo first-line; sleep 0.2; echo second-line".into()]),
      std::env::temp_dir(),
    )
    .await
    .expect("start managed process");

    wait_for_line(&id, "first-line").await;
    for _ in 0..40 {
      let output = read_shell_process(id.clone(), Some(4096)).await.unwrap();
      if !output.running {
        assert!(output.stdout.contains("second-line"));
        break;
      }
      tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let _ = stop_shell_process(id).await;
  }
}

/// End-to-end shape of "write a site and run it locally": serve a file from a
/// background process, read the listening line from its logs, fetch the page,
/// then stop it.  Real child process, real HTTP request.
#[cfg(all(test, windows))]
mod local_server_tests {
  use super::*;

  #[tokio::test]
  async fn serves_a_page_and_stops() {
    let id = format!("local-server-{}", std::process::id());
    let _ = stop_shell_process(id.clone()).await;
    let root = std::env::temp_dir().join(format!("chatless-site-{}", std::process::id()));
    std::fs::create_dir_all(&root).expect("create site dir");
    std::fs::write(root.join("index.html"), "<h1>chatless-e2e</h1>").expect("write index.html");
    // Port chosen well outside the usual dev-server range for this test.
    let port = 8731;

    // Collect problems instead of panicking mid-test: the server must be
    // stopped even when an assertion fails, or the port stays occupied.
    let mut problems: Vec<String> = Vec::new();
    if let Err(error) = start_managed_process(
      ExecuteOptions {
        execution_id: Some(id.clone()),
        command: "python".to_string(),
        // -u keeps the serving banner out of python's pipe buffer.
        args: vec!["-u".into(), "-m".into(), "http.server".into(), port.to_string(), "--bind".into(), "127.0.0.1".into()],
        working_dir: Some(root.to_string_lossy().to_string()),
        timeout_ms: 5_000,
        env: HashMap::new(),
        max_output_size: 1024 * 1024,
      },
      root.clone(),
    )
    .await
    {
      problems.push(format!("start failed: {error}"));
    }

    let mut last_logs = String::new();
    let mut listening = false;
    for _ in 0..60 {
      match read_shell_process(id.clone(), Some(4096)).await {
        Ok(output) => {
          last_logs = format!("stdout={:?} stderr={:?}", output.stdout, output.stderr);
          if output.stderr.contains("Serving HTTP") || output.stdout.contains("Serving HTTP") {
            listening = true;
            break;
          }
          if !output.running {
            break;
          }
        }
        Err(error) => {
          problems.push(format!("read failed: {error}"));
          break;
        }
      }
      tokio::time::sleep(Duration::from_millis(100)).await;
    }
    if !listening {
      problems.push(format!("server never reported that it was listening; logs: {last_logs}"));
    }

    if listening {
      // Localhost must bypass any system proxy, and a bounded timeout keeps a
      // misconfigured server from hanging the test suite.
      match reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(10)).build() {
        Ok(client) => match client
          .get(format!("http://127.0.0.1:{port}/index.html"))
          .send()
          .await
        {
          Ok(response) => match response.text().await {
            Ok(body) => {
              if !body.contains("chatless-e2e") {
                problems.push(format!("unexpected body: {body}"));
              }
            }
            Err(error) => problems.push(format!("read body failed: {error}")),
          },
          Err(error) => problems.push(format!("fetch failed: {error}")),
        },
        Err(error) => problems.push(format!("http client failed: {error}")),
      }
    }

    let stopped = stop_shell_process(id.clone()).await.expect("stop the server");
    if listening && !stopped.stopped {
      problems.push("the running server must be reported as stopped".to_string());
    }
    if read_shell_process(id, Some(1024)).await.is_ok() {
      problems.push("a stopped process is still registered".to_string());
    }
    let _ = std::fs::remove_dir_all(&root);
    assert!(problems.is_empty(), "{problems:?}");
  }
}
