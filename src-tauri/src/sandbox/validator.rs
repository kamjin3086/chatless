//! 命令安全校验器
//!
//! 检测并阻止危险命令的执行

use regex::Regex;
use std::path::Path;

/// 校验结果
#[derive(Debug, Clone, serde::Serialize)]
pub struct ValidationResult {
  /// 是否通过校验
  pub valid: bool,
  /// 失败原因
  pub reason: Option<String>,
  /// 匹配到的模式
  pub matched_pattern: Option<String>,
}

impl ValidationResult {
  pub fn ok() -> Self {
    Self {
      valid: true,
      reason: None,
      matched_pattern: None,
    }
  }

  pub fn fail(reason: impl Into<String>) -> Self {
    Self {
      valid: false,
      reason: Some(reason.into()),
      matched_pattern: None,
    }
  }

  pub fn fail_with_pattern(reason: impl Into<String>, pattern: impl Into<String>) -> Self {
    Self {
      valid: false,
      reason: Some(reason.into()),
      matched_pattern: Some(pattern.into()),
    }
  }
}

/// 危险命令模式
struct DangerousPattern {
  pattern: Regex,
  description: &'static str,
  #[allow(dead_code)]
  severity: &'static str,
}

lazy_static::lazy_static! {
    /// 危险命令模式列表
    static ref DANGEROUS_PATTERNS: Vec<DangerousPattern> = vec![
        // ========== 文件删除操作 ==========
        DangerousPattern {
            pattern: Regex::new(r"(?i)\brm\s+(-[rRfFvV]*\s+)*(-r|-R|--recursive|-f|--force)").unwrap(),
            description: "递归或强制删除文件",
            severity: "critical",
        },
        DangerousPattern {
            pattern: Regex::new(r"(?i)\brm\s+-rf\s+[/~]").unwrap(),
            description: "删除根目录或用户目录",
            severity: "critical",
        },
        DangerousPattern {
            pattern: Regex::new(r"(?i)\bdel\s+/[sS]").unwrap(),
            description: "Windows 递归删除",
            severity: "critical",
        },
        DangerousPattern {
            pattern: Regex::new(r"(?i)\brmdir\s+/[sS]").unwrap(),
            description: "Windows 递归删除目录",
            severity: "critical",
        },
        DangerousPattern {
            pattern: Regex::new(r"(?i)\brd\s+/[sS]").unwrap(),
            description: "Windows 递归删除目录",
            severity: "critical",
        },

        // ========== 系统破坏操作 ==========
        DangerousPattern {
            pattern: Regex::new(r"(?i)\bformat\s+[a-zA-Z]:").unwrap(),
            description: "格式化磁盘",
            severity: "critical",
        },
        DangerousPattern {
            pattern: Regex::new(r"(?i)\bmkfs\b").unwrap(),
            description: "创建文件系统",
            severity: "critical",
        },
        DangerousPattern {
            pattern: Regex::new(r"(?i)\bdd\s+if=").unwrap(),
            description: "dd 命令写入设备",
            severity: "critical",
        },

        // ========== 权限提升 ==========
        DangerousPattern {
            pattern: Regex::new(r"(?i)\bsudo\b").unwrap(),
            description: "使用 sudo 提权",
            severity: "high",
        },
        DangerousPattern {
            pattern: Regex::new(r"(?i)\bsu\s+-?\s*$").unwrap(),
            description: "切换到 root 用户",
            severity: "high",
        },
        DangerousPattern {
            pattern: Regex::new(r"(?i)\brunas\b").unwrap(),
            description: "Windows 提权执行",
            severity: "high",
        },
        DangerousPattern {
            pattern: Regex::new(r"(?i)\bpowershell\s+.*-ExecutionPolicy\s+Bypass").unwrap(),
            description: "PowerShell 绕过执行策略",
            severity: "high",
        },

        // ========== 系统控制 ==========
        DangerousPattern {
            pattern: Regex::new(r"(?i)\bshutdown\b").unwrap(),
            description: "关闭系统",
            severity: "critical",
        },
        DangerousPattern {
            pattern: Regex::new(r"(?i)\breboot\b").unwrap(),
            description: "重启系统",
            severity: "critical",
        },
        DangerousPattern {
            pattern: Regex::new(r"(?i)\bhalt\b").unwrap(),
            description: "停止系统",
            severity: "critical",
        },
        DangerousPattern {
            pattern: Regex::new(r"(?i)\binit\s+[06]\b").unwrap(),
            description: "系统运行级别切换",
            severity: "critical",
        },

        // ========== Fork Bomb ==========
        DangerousPattern {
            pattern: Regex::new(r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:").unwrap(),
            description: "Bash Fork Bomb",
            severity: "critical",
        },
        DangerousPattern {
            pattern: Regex::new(r"%0\|%0").unwrap(),
            description: "Windows Fork Bomb",
            severity: "critical",
        },

        // ========== 危险权限修改 ==========
        DangerousPattern {
            pattern: Regex::new(r"(?i)\bchmod\s+(-R\s+)?777\s+/").unwrap(),
            description: "递归设置危险权限",
            severity: "high",
        },

        // ========== 网络下载执行 ==========
        DangerousPattern {
            pattern: Regex::new(r"(?i)\bcurl\s+.*\|\s*(ba)?sh").unwrap(),
            description: "从网络下载并执行脚本",
            severity: "high",
        },
        DangerousPattern {
            pattern: Regex::new(r"(?i)\bwget\s+.*\|\s*(ba)?sh").unwrap(),
            description: "从网络下载并执行脚本",
            severity: "high",
        },

        // ========== 危险覆盖操作 ==========
        DangerousPattern {
            pattern: Regex::new(r"(?i)>\s*/etc/").unwrap(),
            description: "覆盖系统配置文件",
            severity: "critical",
        },
        DangerousPattern {
            pattern: Regex::new(r"(?i)>\s*C:\\Windows\\").unwrap(),
            description: "覆盖 Windows 系统文件",
            severity: "critical",
        },
    ];

    /// 敏感路径列表 (Unix)
    static ref SENSITIVE_PATHS_UNIX: Vec<(&'static str, &'static str)> = vec![
        ("/etc", "系统配置目录"),
        ("/boot", "启动目录"),
        ("/root", "root 用户目录"),
        ("/sys", "系统文件系统"),
        ("/proc", "进程文件系统"),
        ("/dev", "设备目录"),
        ("/var/log", "系统日志目录"),
    ];

    /// 敏感路径列表 (Windows)
    static ref SENSITIVE_PATHS_WINDOWS: Vec<(&'static str, &'static str)> = vec![
        ("C:\\Windows", "Windows 系统目录"),
        ("C:\\Program Files", "程序安装目录"),
        ("C:\\ProgramData", "程序数据目录"),
    ];
}

/// 命令校验器
pub struct CommandValidator {
  /// 允许的命令白名单
  allowed_commands: Option<Vec<String>>,
  /// 允许的工作目录
  allowed_working_dirs: Option<Vec<String>>,
  /// 是否启用严格模式
  strict_mode: bool,
}

impl Default for CommandValidator {
  fn default() -> Self {
    Self::new()
  }
}

impl CommandValidator {
  /// 创建新的校验器
  pub fn new() -> Self {
    Self {
      allowed_commands: None,
      allowed_working_dirs: None,
      strict_mode: false,
    }
  }

  /// 设置允许的命令白名单
  pub fn with_allowed_commands(mut self, commands: Vec<String>) -> Self {
    self.allowed_commands = Some(commands);
    self
  }

  /// 设置允许的工作目录
  pub fn with_allowed_working_dirs(mut self, dirs: Vec<String>) -> Self {
    self.allowed_working_dirs = Some(dirs);
    self
  }

  /// 启用严格模式
  pub fn with_strict_mode(mut self, strict: bool) -> Self {
    self.strict_mode = strict;
    self
  }

  /// 校验命令安全性
  pub fn validate_command(&self, command: &str) -> ValidationResult {
    // 空命令检查
    if command.trim().is_empty() {
      return ValidationResult::fail("命令不能为空");
    }

    let normalized = command.trim();

    // 检查白名单
    if let Some(ref allowed) = self.allowed_commands {
      let base_cmd = self.extract_base_command(normalized);
      if !allowed.iter().any(|c| c.eq_ignore_ascii_case(&base_cmd)) {
        return ValidationResult::fail(format!("命令 '{}' 不在允许列表中", base_cmd));
      }
    }

    // 检查危险模式
    for pattern in DANGEROUS_PATTERNS.iter() {
      if pattern.pattern.is_match(normalized) {
        return ValidationResult::fail_with_pattern(pattern.description, pattern.pattern.as_str());
      }
    }

    // 严格模式额外检查
    if self.strict_mode {
      if let Some(result) = self.strict_mode_check(normalized) {
        return result;
      }
    }

    ValidationResult::ok()
  }

  /// 校验路径安全性
  pub fn validate_path(&self, path: &str) -> ValidationResult {
    if path.trim().is_empty() {
      return ValidationResult::ok();
    }

    let normalized = path.trim();

    // 检查路径遍历
    if normalized.contains("..") {
      return ValidationResult::fail_with_pattern("检测到路径遍历尝试", "..");
    }

    // 检查敏感路径
    #[cfg(windows)]
    {
      for (sensitive_path, desc) in SENSITIVE_PATHS_WINDOWS.iter() {
        if normalized
          .to_lowercase()
          .starts_with(&sensitive_path.to_lowercase())
        {
          return ValidationResult::fail(format!("禁止访问 {}: {}", desc, normalized));
        }
      }
    }

    #[cfg(not(windows))]
    {
      for (sensitive_path, desc) in SENSITIVE_PATHS_UNIX.iter() {
        if normalized.starts_with(sensitive_path) {
          return ValidationResult::fail(format!("禁止访问 {}: {}", desc, normalized));
        }
      }
    }

    // 检查允许的工作目录
    if let Some(ref allowed) = self.allowed_working_dirs {
      let path_obj = Path::new(normalized);
      let is_allowed = allowed.iter().any(|dir| {
        let dir_path = Path::new(dir);
        path_obj.starts_with(dir_path)
      });

      if !is_allowed {
        return ValidationResult::fail(format!("路径不在允许的目录范围内: {}", normalized));
      }
    }

    ValidationResult::ok()
  }

  /// 提取基础命令
  fn extract_base_command(&self, command: &str) -> String {
    command.split_whitespace().next().unwrap_or("").to_string()
  }

  /// 严格模式检查
  fn strict_mode_check(&self, command: &str) -> Option<ValidationResult> {
    // 检查命令替换
    if command.contains("$(") || command.contains('`') {
      return Some(ValidationResult::fail_with_pattern(
        "严格模式下不允许命令替换",
        "$() or ``",
      ));
    }

    // 检查 rm 命令使用通配符
    let rm_wildcard = Regex::new(r"(?i)\brm\s+.*\*").unwrap();
    if rm_wildcard.is_match(command) {
      return Some(ValidationResult::fail_with_pattern(
        "严格模式下 rm 命令不允许使用通配符",
        "rm *",
      ));
    }

    None
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_dangerous_commands() {
    let validator = CommandValidator::new();

    // 危险命令应该被拒绝
    assert!(!validator.validate_command("rm -rf /").valid);
    assert!(!validator.validate_command("sudo apt-get install").valid);
    assert!(!validator.validate_command("shutdown -h now").valid);
    assert!(!validator.validate_command("format C:").valid);

    // 安全命令应该通过
    assert!(validator.validate_command("ls -la").valid);
    assert!(validator.validate_command("echo hello").valid);
    assert!(validator.validate_command("python script.py").valid);
  }

  #[test]
  fn test_path_validation() {
    let validator = CommandValidator::new();

    // 路径遍历应该被拒绝
    assert!(!validator.validate_path("../../../etc/passwd").valid);

    // 普通路径应该通过
    assert!(validator.validate_path("/home/user/project").valid);
  }
}
