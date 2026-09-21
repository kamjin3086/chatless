//! Sandbox 安全执行命令
//!
//! 提供受限的命令执行能力，包含安全校验、超时控制和工作目录限制

use crate::sandbox::validator::{CommandValidator, ValidationResult};
use serde::{Deserialize, Serialize};
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

  Ok(false)
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
        error: Some(format!("命令执行失败: {}", e)),
      })
    }
    Err(_) => {
      // 超时，尝试终止进程
      log::warn!("[Sandbox] Command timed out after {}ms", options.timeout_ms);
      let process = ManagedProcess { pid, #[cfg(windows)] job: job.clone() };
      // Report a failed tree kill as a result rather than an early return, so
      // the registry entry is always cleared and a reused pid can never be
      // cancelled by a later request.
      match kill_process_tree(process).await {
        Ok(()) => {
          let _ = child.wait().await;
          Ok(ShellResult {
            success: false,
            exit_code: -1,
            stdout: String::new(),
            stderr: String::new(),
            duration_ms: options.timeout_ms,
            error: Some(format!("命令执行超时 ({}ms)", options.timeout_ms)),
          })
        }
        Err(error) => Ok(ShellResult {
          success: false,
          exit_code: -1,
          stdout: String::new(),
          stderr: String::new(),
          duration_ms: options.timeout_ms,
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
  let mut kept = Vec::new();
  let mut buffer = [0_u8; 8192];
  let mut truncated = false;
  while let Ok(count) = reader.read(&mut buffer).await {
    if count == 0 { break; }
    let available = limit.saturating_sub(kept.len()).min(count);
    kept.extend_from_slice(&buffer[..available]);
    truncated |= available < count;
  }
  let mut output = String::from_utf8_lossy(&kept).into_owned();
  if truncated { output.push_str("\n[输出已截断]"); }
  output
}

#[cfg(test)]
mod output_tests {
  use super::drain_output;
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
    assert_eq!(output, format!("{}\n[输出已截断]", "x".repeat(100)));
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
