use serde::{Deserialize, Serialize};

// ================================
// Filesystem 类型定义
// ================================
// 规范：
// - Rust 端统一使用 snake_case 命名
// - 前端负责在调用 invoke 前将 camelCase 转换为 snake_case
// - 不使用 serde 的 alias 或 rename 进行大小写兼容
// ================================

/// 文件/目录条目
#[derive(Debug, Clone, Serialize)]
pub struct FsEntry {
  pub name: String,
  pub path: String,
  pub is_directory: bool,
  pub is_file: bool,
}

/// 列出目录结果
#[derive(Debug, Clone, Serialize)]
pub struct ListDirectoryResult {
  pub ok: bool,
  pub path: String,
  pub entries: Vec<FsEntry>,
  pub truncated: bool,
  pub returned_count: u32,
  pub limit: u32,
}

/// 批量删除 payload
#[derive(Debug, Clone, Deserialize)]
pub struct DeleteManyPayload {
  pub paths: Vec<String>,
}

/// 按模式删除 payload
#[derive(Debug, Clone, Deserialize)]
pub struct DeleteByPatternPayload {
  pub dir: String,
  pub pattern: String,
  pub limit: Option<u32>,
  pub kind: Option<String>,
  pub dry_run: Option<bool>,
}

/// 通用操作结果
#[derive(Debug, Clone, Serialize)]
pub struct OkResult {
  pub ok: bool,
  pub message: String,
  pub path: String,
}

/// 读取文件 payload
#[derive(Debug, Clone, Deserialize)]
pub struct ReadFilePayload {
  pub path: String,
  pub max_lines: Option<u32>,
  pub start_line: Option<u32>,
  pub end_line: Option<u32>,
}

/// 写入文件 payload
#[derive(Debug, Clone, Deserialize)]
pub struct WriteFilePayload {
  pub path: String,
  pub content: String,
}

/// 列出目录 payload
#[derive(Debug, Clone, Deserialize)]
pub struct ListDirectoryPayload {
  pub path: String,
  pub limit: Option<u32>,
  pub pattern: Option<String>,
  pub kind: Option<String>,
}

/// 创建目录 payload
#[derive(Debug, Clone, Deserialize)]
pub struct CreateDirectoryPayload {
  pub path: String,
  pub recursive: Option<bool>,
}

/// 删除文件 payload
#[derive(Debug, Clone, Deserialize)]
pub struct DeleteFilePayload {
  pub path: String,
}

/// 重命名文件 payload
#[derive(Debug, Clone, Deserialize)]
pub struct RenameFilePayload {
  pub old_path: String,
  pub new_path: String,
}

/// 读取文件结果
#[derive(Debug, Clone, Serialize)]
pub struct ReadFileResult {
  pub ok: bool,
  pub path: String,
  pub total_lines: u32,
  pub start_line: u32,
  pub end_line: u32,
  pub content: String,
  pub truncated: bool,
}

/// 设置 allowlist payload
#[derive(Debug, Clone, Deserialize)]
pub struct SetAllowlistPayload {
  pub directories: Vec<super::state::AllowlistDirectory>,
  pub version: Option<u32>,
}
