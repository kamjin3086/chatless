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
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::time::{timeout, Duration};
use std::sync::Mutex;

use lazy_static::lazy_static;

lazy_static! {
  // Store only the OS process id.  Waiting for a child must never hold a lock
  // that cancellation needs in order to terminate it.
  static ref RUNNING_SHELLS: Mutex<HashMap<String, u32>> =
    Mutex::new(HashMap::new());
}

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

async fn kill_process_tree(pid: u32) -> std::io::Result<()> {
  if pid == 0 {
    return Ok(());
  }
  #[cfg(windows)]
  {
    let status = Command::new("taskkill")
      .args(["/PID", &pid.to_string(), "/T", "/F"])
      .status()
      .await?;
    if status.success() { Ok(()) } else { Err(std::io::Error::new(std::io::ErrorKind::Other, "taskkill failed")) }
  }
  #[cfg(not(windows))]
  {
    let status = Command::new("kill")
      .args(["-TERM", &pid.to_string()])
      .status()
      .await?;
    if status.success() { Ok(()) } else { Err(std::io::Error::new(std::io::ErrorKind::Other, "kill failed")) }
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

  if let Some(pid) = handle {
    let _ = kill_process_tree(pid).await;
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

  // 创建校验器，限制工作目录并启用严格模式
  let validator = CommandValidator::new()
    .with_strict_mode(true)
    .with_allowed_commands(vec![
      "git".into(),
      "node".into(),
      "npm".into(),
      "pnpm".into(),
      "yarn".into(),
      "python".into(),
      "python3".into(),
      "pip".into(),
      "cargo".into(),
      "rustc".into(),
      "go".into(),
      "echo".into(),
      "dir".into(),
      "type".into(),
      "where".into(),
      "which".into(),
      "cat".into(),
      "ls".into(),
      "pwd".into(),
      "cd".into(),
    ])
    .with_allowed_working_dirs(vec![
      app_data_dir.to_string_lossy().to_string(),
      std::env::temp_dir().to_string_lossy().to_string(),
    ]);

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

  // 启动进程
  let mut child = cmd.spawn().map_err(|e| format!("启动命令失败: {}", e))?;
  let pid = child.id().unwrap_or_default();

  // 注册到全局 map（用于 cancel）
  let exec_id = options.execution_id.clone().unwrap_or_default();
  if !exec_id.trim().is_empty() {
    if let Ok(mut map) = RUNNING_SHELLS.lock() {
      map.insert(exec_id.clone(), pid);
    }
  }

  // 获取输出流
  let stdout = child.stdout.take();
  let stderr = child.stderr.take();

  // 异步读取输出
  let max_output = options.max_output_size;

  let stdout_handle = tokio::spawn(async move {
    let mut output = String::new();
    if let Some(stdout) = stdout {
      let mut reader = BufReader::new(stdout).lines();
      while let Ok(Some(line)) = reader.next_line().await {
        if output.len() + line.len() < max_output {
          if !output.is_empty() {
            output.push('\n');
          }
          output.push_str(&line);
        } else {
          output.push_str("\n[输出已截断]");
          break;
        }
      }
    }
    output
  });

  let stderr_handle = tokio::spawn(async move {
    let mut output = String::new();
    if let Some(stderr) = stderr {
      let mut reader = BufReader::new(stderr).lines();
      while let Ok(Some(line)) = reader.next_line().await {
        if output.len() + line.len() < max_output {
          if !output.is_empty() {
            output.push('\n');
          }
          output.push_str(&line);
        } else {
          output.push_str("\n[输出已截断]");
          break;
        }
      }
    }
    output
  });

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
      let _ = kill_process_tree(pid).await;
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
