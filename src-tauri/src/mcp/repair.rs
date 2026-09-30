use crate::env_setup::EnvironmentSetup;
use std::path::Path;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunnerKind {
  Npx,
  Uvx,
  Bunx,
  Direct,
}

impl RunnerKind {
  pub fn tool_name(self) -> &'static str {
    match self {
      Self::Npx => "npx",
      Self::Uvx => "uvx",
      Self::Bunx => "bunx",
      Self::Direct => "",
    }
  }

  pub fn is_package_runner(self) -> bool {
    matches!(self, Self::Npx | Self::Uvx | Self::Bunx)
  }
}

#[derive(Debug, Clone)]
pub struct ResolvedStdio {
  pub program: String,
  pub args: Vec<String>,
  pub runner: RunnerKind,
  pub package: Option<String>,
  pub repaired_runner: bool,
}

pub fn unwrap_cmd_wrapper(command: &str, args: &[String]) -> (String, Vec<String>) {
  let is_cmd = command.eq_ignore_ascii_case("cmd") || command.eq_ignore_ascii_case("cmd.exe");
  let is_slash_c = args
    .first()
    .map(|s| s.eq_ignore_ascii_case("/c"))
    .unwrap_or(false);
  if is_cmd && is_slash_c && args.len() >= 2 {
    return (args[1].clone(), args[2..].to_vec());
  }
  (command.to_string(), args.to_vec())
}

pub fn classify_runner(command: &str) -> RunnerKind {
  let name = Path::new(command)
    .file_stem()
    .and_then(|s| s.to_str())
    .unwrap_or(command)
    .to_ascii_lowercase();
  match name.as_str() {
    "npx" => RunnerKind::Npx,
    "uvx" => RunnerKind::Uvx,
    "bunx" => RunnerKind::Bunx,
    _ => RunnerKind::Direct,
  }
}

pub fn looks_like_missing_program(err: &str) -> bool {
  let e = err.to_ascii_lowercase();
  e.contains("program not found")
    || e.contains("os error 2")
    || e.contains("cannot find the file")
    || e.contains("the system cannot find the file")
    || e.contains("not recognized as an internal")
    || e.contains("no such file or directory")
    || e.contains("is not recognized")
    || e.contains("enoent")
}

pub fn extract_package(args: &[String]) -> Option<String> {
  let mut i = 0;
  while i < args.len() {
    let a = &args[i];
    if let Some(pkg) = a
      .strip_prefix("--package=")
      .or_else(|| a.strip_prefix("--from="))
      .or_else(|| a.strip_prefix("-p="))
    {
      if !pkg.is_empty() {
        return Some(pkg.to_string());
      }
    }
    if a == "-p" || a == "--package" || a == "--from" {
      return args.get(i + 1).cloned();
    }
    if a.starts_with('-') {
      i += 1;
      continue;
    }
    return Some(a.clone());
  }
  None
}

pub fn missing_runner_hint(runner: RunnerKind) -> String {
  match runner {
    RunnerKind::Npx => {
      "npx 不存在且无法自动修复。请安装 Node.js（https://nodejs.org/）后再次刷新。".to_string()
    }
    RunnerKind::Uvx => {
      "uvx 不存在且无法自动修复。请安装 uv（https://docs.astral.sh/uv/）后再次刷新。".to_string()
    }
    RunnerKind::Bunx => {
      "bunx 不存在。请安装 Bun（https://bun.sh/）后再次刷新。".to_string()
    }
    RunnerKind::Direct => "可执行文件不存在。".to_string(),
  }
}

fn refreshed_env() -> EnvironmentSetup {
  EnvironmentSetup::with_refreshed_path()
}

pub fn resolve_tool(name: &str) -> Option<String> {
  refreshed_env().resolve_tool_path(name)
}

/// Prepare the real program path for a stdio MCP. If the runner is missing,
/// try to reinstall it and prefetch the package.
pub async fn prepare_stdio(command: &str, args: &[String]) -> Result<ResolvedStdio, String> {
  let (inner_cmd, inner_args) = unwrap_cmd_wrapper(command, args);
  let runner = classify_runner(&inner_cmd);
  let package = extract_package(&inner_args);
  let mut repaired_runner = false;

  let program = if runner == RunnerKind::Direct {
    if Path::new(&inner_cmd).exists() {
      inner_cmd.clone()
    } else if let Some(resolved) = resolve_tool(&inner_cmd) {
      resolved
    } else {
      return Err(format!(
        "executable not found: {inner_cmd}. Refresh cannot reinstall an unknown binary."
      ));
    }
  } else if Path::new(&inner_cmd).exists() {
    inner_cmd.clone()
  } else {
    match resolve_tool(runner.tool_name()) {
      Some(path) => path,
      None => {
        repaired_runner = true;
        log::info!(
          "[MCP/repair] {} not found, attempting reinstall",
          runner.tool_name()
        );
        ensure_runner(runner).await?
      }
    }
  };

  if repaired_runner {
    if let Some(pkg) = package.as_deref() {
      log::info!("[MCP/repair] runner restored, prefetching {pkg}");
      prefetch(runner, &program, pkg).await?;
    }
  }

  Ok(ResolvedStdio {
    program,
    args: inner_args,
    runner,
    package,
    repaired_runner,
  })
}

pub async fn ensure_runner(runner: RunnerKind) -> Result<String, String> {
  if let Some(existing) = resolve_tool(runner.tool_name()) {
    return Ok(existing);
  }
  match runner {
    RunnerKind::Npx => repair_npx().await,
    RunnerKind::Uvx => repair_uvx().await,
    RunnerKind::Bunx => Err(missing_runner_hint(runner)),
    RunnerKind::Direct => Err(missing_runner_hint(runner)),
  }
}

pub async fn prefetch(runner: RunnerKind, program: &str, pkg: &str) -> Result<(), String> {
  match runner {
    RunnerKind::Npx => {
      run_hidden(
        program,
        &["-y", "-p", pkg, "node", "-e", "process.exit(0)"],
        180,
        "npx prefetch",
      )
      .await
    }
    RunnerKind::Uvx => {
      run_hidden(
        program,
        &[
          "--from",
          pkg,
          "--refresh",
          "python",
          "-c",
          "raise SystemExit(0)",
        ],
        180,
        "uvx prefetch",
      )
      .await
    }
    RunnerKind::Bunx => {
      run_hidden(
        program,
        &[
          "--package",
          pkg,
          "bun",
          "-e",
          "process.exit(0)",
        ],
        180,
        "bunx prefetch",
      )
      .await
    }
    RunnerKind::Direct => Ok(()),
  }
}

pub fn build_stdio_command(
  program: &str,
  args: &[String],
  extra_env: Option<&Vec<(String, String)>>,
  runner: RunnerKind,
) -> Command {
  let mut c = Command::new(program);
  #[cfg(windows)]
  {
    c.creation_flags(CREATE_NO_WINDOW);
  }
  c.env("PATH", refreshed_env().get_updated_path());
  c.args(args);
  if let Some(envs) = extra_env {
    for (k, v) in envs {
      c.env(k, v);
    }
  }
  match runner {
    RunnerKind::Npx => {
      c.env("NPM_CONFIG_LOGLEVEL", "silent");
      c.env("NO_COLOR", "1");
      c.env("NPX_Y", "1");
    }
    RunnerKind::Uvx | RunnerKind::Bunx => {
      c.env("NO_COLOR", "1");
    }
    RunnerKind::Direct => {}
  }
  c
}

async fn repair_npx() -> Result<String, String> {
  let npm = resolve_tool("npm").ok_or_else(|| missing_runner_hint(RunnerKind::Npx))?;
  log::info!("[MCP/repair] installing npx via npm");
  run_hidden(&npm, &["install", "-g", "npx"], 120, "npm install -g npx").await?;
  resolve_tool("npx").ok_or_else(|| {
    "npx still missing after npm install -g npx. Install Node.js from https://nodejs.org/ and refresh again.".to_string()
  })
}

async fn repair_uvx() -> Result<String, String> {
  if let Some(python) = resolve_tool("python")
    .or_else(|| resolve_tool("python3"))
    .or_else(|| resolve_tool("py"))
  {
    log::info!("[MCP/repair] installing uv via pip ({python})");
    let is_py = Path::new(&python)
      .file_stem()
      .and_then(|s| s.to_str())
      .map(|s| s.eq_ignore_ascii_case("py"))
      .unwrap_or(false);
    let pip_ok = if is_py {
      run_hidden(
        &python,
        &["-3", "-m", "pip", "install", "--user", "uv"],
        120,
        "pip install uv",
      )
      .await
    } else {
      run_hidden(
        &python,
        &["-m", "pip", "install", "--user", "uv"],
        120,
        "pip install uv",
      )
      .await
    };
    if pip_ok.is_ok() {
      if let Some(path) = resolve_uvx() {
        return Ok(path);
      }
    }
  }

  log::info!("[MCP/repair] installing uv via official installer");
  install_uv_official().await?;
  resolve_uvx().ok_or_else(|| missing_runner_hint(RunnerKind::Uvx))
}

fn resolve_uvx() -> Option<String> {
  resolve_tool("uvx").or_else(|| resolve_tool("uv").and_then(|uv| sibling_tool(&uv, "uvx")))
}

fn sibling_tool(path: &str, name: &str) -> Option<String> {
  let dir = Path::new(path).parent()?;
  #[cfg(windows)]
  {
    for ext in ["exe", "cmd", "bat"] {
      let candidate = dir.join(format!("{name}.{ext}"));
      if candidate.exists() {
        return Some(candidate.to_string_lossy().to_string());
      }
    }
  }
  let candidate = dir.join(name);
  if candidate.exists() {
    Some(candidate.to_string_lossy().to_string())
  } else {
    None
  }
}

async fn install_uv_official() -> Result<(), String> {
  #[cfg(windows)]
  {
    let powershell = resolve_tool("powershell")
      .or_else(|| resolve_tool("pwsh"))
      .ok_or_else(|| missing_runner_hint(RunnerKind::Uvx))?;
    return run_hidden(
      &powershell,
      &[
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "irm https://astral.sh/uv/install.ps1 | iex",
      ],
      120,
      "uv installer",
    )
    .await;
  }
  #[cfg(not(windows))]
  {
    let curl = resolve_tool("curl").ok_or_else(|| missing_runner_hint(RunnerKind::Uvx))?;
    let mut cmd = Command::new("sh");
    cmd.args([
      "-lc",
      &format!("{curl} -LsSf https://astral.sh/uv/install.sh | sh"),
    ]);
    run_status(cmd, 120, "uv installer").await
  }
}

async fn run_hidden(
  program: &str,
  args: &[&str],
  timeout_secs: u64,
  label: &str,
) -> Result<(), String> {
  log::info!("[MCP/repair] {label}: {program} {args:?}");
  let mut cmd = Command::new(program);
  #[cfg(windows)]
  {
    cmd.creation_flags(CREATE_NO_WINDOW);
  }
  cmd.env("PATH", refreshed_env().get_updated_path());
  cmd.args(args);
  run_status(cmd, timeout_secs, label).await
}

async fn run_status(mut cmd: Command, timeout_secs: u64, label: &str) -> Result<(), String> {
  let status = timeout(Duration::from_secs(timeout_secs), cmd.status())
    .await
    .map_err(|_| format!("{label} timed out"))?
    .map_err(|e| format!("{label} failed: {e}"))?;
  if !status.success() {
    return Err(format!(
      "{label} failed with code {:?}",
      status.code()
    ));
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn unwraps_windows_cmd_wrapper() {
    let args = vec![
      "/c".into(),
      "npx".into(),
      "-y".into(),
      "@modelcontextprotocol/server-filesystem".into(),
      r"C:\Users\me\docs".into(),
    ];
    let (cmd, rest) = unwrap_cmd_wrapper("cmd", &args);
    assert_eq!(cmd, "npx");
    assert_eq!(rest[0], "-y");
    assert_eq!(rest[1], "@modelcontextprotocol/server-filesystem");
  }

  #[test]
  fn classify_npx_cmd_path() {
    assert_eq!(
      classify_runner(r"C:\Program Files\nodejs\npx.cmd"),
      RunnerKind::Npx
    );
    assert_eq!(classify_runner("uvx"), RunnerKind::Uvx);
    assert_eq!(classify_runner("/usr/bin/python"), RunnerKind::Direct);
  }

  #[test]
  fn extracts_npx_and_uvx_packages() {
    let npx = vec![
      "-y".into(),
      "@modelcontextprotocol/server-filesystem".into(),
      r"C:\Users\me\docs".into(),
    ];
    assert_eq!(
      extract_package(&npx).as_deref(),
      Some("@modelcontextprotocol/server-filesystem")
    );

    let uvx = vec![
      "mcp-server-git".into(),
      "--repository".into(),
      r"D:\repo".into(),
    ];
    assert_eq!(extract_package(&uvx).as_deref(), Some("mcp-server-git"));

    let from = vec!["--from".into(), "some-pkg".into(), "python".into()];
    assert_eq!(extract_package(&from).as_deref(), Some("some-pkg"));
  }

  #[test]
  fn detects_missing_program_errors() {
    assert!(looks_like_missing_program(
      "program not found; prefetch: program not found"
    ));
    assert!(looks_like_missing_program(
      "The system cannot find the file specified. (os error 2)"
    ));
    assert!(!looks_like_missing_program("Connect timeout (stdio)"));
  }
}
