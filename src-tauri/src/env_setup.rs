use log::{info, trace, warn};
use serde::Serialize;
use std::env;
use std::path::Path;

// ── Cross-platform helpers ─────────────────────────────────────────────────
// PATH separator differs between Windows (';') and Unix (':'). Define a
// small constant so that every place that splits or joins PATH values picks
// the correct character at compile time.
#[cfg(windows)]
const PATH_SEPARATOR: &str = ";";
#[cfg(not(windows))]
const PATH_SEPARATOR: &str = ":";

#[derive(Debug, Clone, Serialize)]
pub struct ToolAvailability {
  pub tool_name: String,
  pub available: bool,
  pub path: Option<String>,
  pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EnvironmentHealth {
  pub overall_healthy: bool,
  pub tools: Vec<ToolAvailability>,
  pub missing_critical_tools: Vec<String>,
  pub recommendations: Vec<String>,
}

pub struct EnvironmentSetup {
  #[allow(dead_code)]
  original_path: String, // 保留用于调试和演示
  updated_path: String,
}

fn collect_python_script_dirs(root: std::path::PathBuf, paths: &mut Vec<String>) {
  if let Ok(entries) = std::fs::read_dir(root) {
    for entry in entries.flatten() {
      let scripts = entry.path().join("Scripts");
      if scripts.is_dir() {
        paths.push(scripts.to_string_lossy().to_string());
      }
    }
  }
}

impl EnvironmentSetup {
  pub fn new() -> Self {
    let original_path = env::var("PATH").unwrap_or_default();
    Self {
      original_path: original_path.clone(),
      updated_path: original_path,
    }
  }

  pub fn setup(&mut self) -> Result<(), Box<dyn std::error::Error>> {
    info!("[ENV] Starting environment setup...");
    self.setup_path()?;
    self.setup_other_env_vars()?;
    env::set_var("PATH", &self.updated_path);
    info!("[ENV] Environment setup completed successfully");
    Ok(())
  }

  fn setup_path(&mut self) -> Result<(), Box<dyn std::error::Error>> {
    let mut new_paths = Vec::new();
    new_paths.extend(self.get_platform_specific_paths());
    new_paths.extend(self.get_user_specific_paths()?);

    for path in new_paths {
      if Path::new(&path).exists() && !self.updated_path.contains(&path) {
        self.updated_path = format!("{}{}{}", path, PATH_SEPARATOR, self.updated_path);
        // 降低噪音：PATH 变更细节仅在 trace 级别输出
        trace!("[ENV] Added to PATH: {}", path);
      }
    }
    Ok(())
  }

  fn get_platform_specific_paths(&self) -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
      vec![
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/local/opt/node/bin".to_string(),
      ]
    }

    #[cfg(target_os = "linux")]
    {
      vec!["/usr/local/bin".to_string(), "/opt/nodejs/bin".to_string()]
    }

    #[cfg(target_os = "windows")]
    {
      let user_profile = env::var("USERPROFILE").unwrap_or_default();
      let local_app = env::var("LOCALAPPDATA").unwrap_or_default();
      vec![
        r"C:\Program Files\nodejs".to_string(),
        format!(r"{}\AppData\Roaming\npm", user_profile),
        format!(r"{}\.local\bin", user_profile),
        format!(r"{}\.cargo\bin", user_profile),
        format!(r"{}\Programs\uv", local_app),
        format!(r"{}\pnpm", local_app),
      ]
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
      vec![]
    }
  }

  fn get_user_specific_paths(&self) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let mut paths = Vec::new();

    let home = env::var("HOME")
      .ok()
      .or_else(|| env::var("USERPROFILE").ok());

    if let Some(home) = home {
      let user_paths = [
        format!("{}/.npm-global/bin", home),
        format!("{}/.local/bin", home),
        format!("{}/.cargo/bin", home),
        format!("{}/.nvm/versions/node/current/bin", home),
      ];

      for path in user_paths {
        if Path::new(&path).exists() {
          paths.push(path);
        }
      }
    }

    if let Ok(roaming) = env::var("APPDATA") {
      collect_python_script_dirs(Path::new(&roaming).join("Python"), &mut paths);
    }
    if let Ok(local) = env::var("LOCALAPPDATA") {
      collect_python_script_dirs(
        Path::new(&local).join("Programs").join("Python"),
        &mut paths,
      );
    }

    Ok(paths)
  }

  fn setup_other_env_vars(&self) -> Result<(), Box<dyn std::error::Error>> {
    if env::var("NODE_ENV").is_err() {
      env::set_var("NODE_ENV", "production");
    }
    Ok(())
  }

  pub fn with_refreshed_path() -> Self {
    let mut env = Self::new();
    if let Err(e) = env.setup() {
      warn!("[ENV] Failed to refresh PATH: {}", e);
    }
    env
  }

  pub fn get_updated_path(&self) -> &str {
    &self.updated_path
  }

  pub fn verify_tool_availability(&self, tool_name: &str) -> bool {
    self.resolve_tool_path(tool_name).is_some()
  }

  /// Resolve a tool to a real executable path (e.g. `npx.cmd` on Windows).
  pub fn resolve_tool_path(&self, tool_name: &str) -> Option<String> {
    if tool_name.contains('/') || tool_name.contains('\\') {
      let p = Path::new(tool_name);
      if p.exists() {
        return Some(tool_name.to_string());
      }
    }

    for dir in self.updated_path.split(PATH_SEPARATOR) {
      if let Some(found) = Self::find_tool_in_directory(dir, tool_name) {
        return Some(found.to_string_lossy().to_string());
      }
    }

    warn!("[ENV] Tool {} not found in PATH", tool_name);
    None
  }

  fn find_tool_in_directory(dir: &str, tool_name: &str) -> Option<std::path::PathBuf> {
    let dir_clean = dir.trim_matches('"');
    if dir_clean.is_empty() {
      return None;
    }

    let base = Path::new(dir_clean);
    if !base.exists() {
      trace!("[ENV] Skipping non-existent PATH entry: {}", dir_clean);
      return None;
    }
    trace!("[ENV] Scanning {} for {}", dir_clean, tool_name);

    #[cfg(windows)]
    {
      let pathext = std::env::var("PATHEXT").unwrap_or(".EXE;.CMD;.BAT;.COM".into());
      let mut exts: Vec<String> = pathext
        .split(';')
        .map(|s| s.trim().trim_start_matches('.').to_string())
        .filter(|s| !s.is_empty())
        .collect();
      // Node shims are typically `.cmd`; prefer them before `.ps1` if present.
      const PREFERRED: [&str; 3] = ["CMD", "EXE", "BAT"];
      exts.sort_by_key(|e| {
        PREFERRED
          .iter()
          .position(|p| e.eq_ignore_ascii_case(p))
          .unwrap_or(PREFERRED.len())
      });
      for ext in exts {
        let file_name = format!("{}.{}", tool_name, ext.to_lowercase());
        let candidate = base.join(&file_name);
        if candidate.exists() {
          trace!("[ENV] Found {} at: {}", tool_name, candidate.display());
          return Some(candidate);
        }
      }
      let plain = base.join(tool_name);
      if plain.exists() {
        return Some(plain);
      }
    }

    #[cfg(not(windows))]
    {
      let candidate = base.join(tool_name);
      if candidate.exists() {
        trace!("[ENV] Found {} at: {}", tool_name, candidate.display());
        return Some(candidate);
      }
    }

    None
  }

  /// 检查工具的详细可用性（由 lib.rs 中的 Tauri 命令调用）
  #[allow(dead_code)]
  pub fn check_tool_availability_detailed(&self, tool_name: &str) -> ToolAvailability {
    if let Some(path) = self.resolve_tool_path(tool_name) {
      return ToolAvailability {
        tool_name: tool_name.to_string(),
        available: true,
        path: Some(path),
        error_message: None,
      };
    }

    ToolAvailability {
      tool_name: tool_name.to_string(),
      available: false,
      path: None,
      error_message: Some(format!("{} not found in PATH", tool_name)),
    }
  }

  /// 执行完整的环境健康检查（由 lib.rs 中的 Tauri 命令调用）
  #[allow(dead_code)]
  pub fn perform_health_check(&self) -> EnvironmentHealth {
    let critical_tools = ["node", "npm", "npx"];
    let mut tools = Vec::new();
    let mut missing_critical = Vec::new();
    let mut recommendations = Vec::new();

    for tool in &critical_tools {
      let availability = self.check_tool_availability_detailed(tool);
      if !availability.available {
        missing_critical.push(tool.to_string());

        // 根据工具提供具体的安装建议
        match tool.as_ref() {
          "node" => {
            recommendations.push("Install Node.js from https://nodejs.org/".to_string());
            recommendations.push(
              "Or use package manager: brew install node (macOS), apt install nodejs (Ubuntu)"
                .to_string(),
            );
          }
          "npm" => {
            recommendations.push("npm usually comes with Node.js".to_string());
            recommendations.push("If missing, try: npm install -g npm".to_string());
          }
          "npx" => {
            recommendations.push("npx usually comes with npm 5.2+".to_string());
            recommendations.push("If missing, try: npm install -g npx".to_string());
            recommendations.push("Or update npm: npm install -g npm@latest".to_string());
          }
          _ => {}
        }
      }
      tools.push(availability);
    }

    let overall_healthy = missing_critical.is_empty();

    EnvironmentHealth {
      overall_healthy,
      tools,
      missing_critical_tools: missing_critical,
      recommendations,
    }
  }
}

pub fn setup_environment() -> Result<(), Box<dyn std::error::Error>> {
  let mut env_setup = EnvironmentSetup::new();
  env_setup.setup()?;

  let tools = ["node", "npm", "npx"];
  for tool in &tools {
    if env_setup.verify_tool_availability(tool) {
      info!("[ENV] ✓ {} is available", tool);
    } else {
      warn!("[ENV] ✗ {} is not available", tool);
    }
  }

  Ok(())
}

/// 获取环境健康状态（由 lib.rs 中的 Tauri 命令调用）
#[allow(dead_code)]
pub fn get_environment_health() -> EnvironmentHealth {
  EnvironmentSetup::with_refreshed_path().perform_health_check()
}

/// 检查 MCP 服务是否可以正常运行（由 lib.rs 中的 Tauri 命令调用）
#[allow(dead_code)]
pub fn can_run_mcp_services() -> bool {
  let health = get_environment_health();
  health.overall_healthy
}

/// 专门检查 npx 是否可用（由 lib.rs 中的 Tauri 命令调用）
#[allow(dead_code)]
pub fn check_npx_availability() -> ToolAvailability {
  EnvironmentSetup::with_refreshed_path().check_tool_availability_detailed("npx")
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_environment_setup_creation() {
    let env_setup = EnvironmentSetup::new();
    assert!(!env_setup.original_path.is_empty());
  }

  #[test]
  fn test_platform_specific_paths() {
    let env_setup = EnvironmentSetup::new();
    let paths = env_setup.get_platform_specific_paths();
    assert!(!paths.is_empty());
  }

  #[cfg(windows)]
  #[test]
  fn resolve_cmd_uses_real_executable() {
    let env_setup = EnvironmentSetup::with_refreshed_path();
    let path = env_setup
      .resolve_tool_path("cmd")
      .expect("cmd.exe should be on PATH");
    assert!(
      path.to_ascii_lowercase().ends_with("cmd.exe"),
      "expected cmd.exe, got {path}"
    );
  }
}

/// 演示函数：展示环境变量设置前后的差异（用于调试）
#[allow(dead_code)]
pub fn demonstrate_environment_setup() -> Result<(), Box<dyn std::error::Error>> {
  println!("=== Environment Setup Demonstration ===");

  // 显示原始环境
  let original_path = env::var("PATH").unwrap_or_default();
  println!("Original PATH length: {}", original_path.len());
  println!("Original PATH: {}", original_path);

  // 设置环境
  let mut env_setup = EnvironmentSetup::new();
  env_setup.setup()?;

  // 显示更新后的环境
  let updated_path = env_setup.get_updated_path();
  println!("Updated PATH length: {}", updated_path.len());
  println!("Updated PATH: {}", updated_path);

  // 验证工具可用性
  let tools = ["node", "npm", "npx", "ls", "echo"];
  println!("\nTool availability check:");
  for tool in &tools {
    let available = env_setup.verify_tool_availability(tool);
    println!("  {}: {}", tool, if available { "✓" } else { "✗" });
  }

  println!("=== End of Demonstration ===");
  Ok(())
}
