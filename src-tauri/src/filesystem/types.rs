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
  /// 本次覆盖前的版本 ID（若已备份）。
  #[serde(skip_serializing_if = "Option::is_none")]
  pub history_id: Option<String>,
  /// 该文件当前保留的历史版本数。
  #[serde(skip_serializing_if = "Option::is_none")]
  pub history_count: Option<u32>,
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

/// 精确编辑 payload：把 `find` 替换为 `replace`，默认要求唯一匹配
#[derive(Debug, Clone, Deserialize)]
pub struct EditFilePayload {
  pub path: String,
  pub find: String,
  pub replace: String,
  pub all: Option<bool>,
  /// sha256 of the file the caller read. When present, an edit refuses to touch
  /// a file that changed since, instead of overwriting someone else's work.
  pub expected_hash: Option<String>,
}

/// 精确编辑结果。匹配不唯一/未命中不是 IO 错误，因此作为结构化结果返回。
#[derive(Debug, Clone, Serialize)]
pub struct EditFileResult {
  pub ok: bool,
  pub path: String,
  pub replacements: u32,
  /// 1-based line number of the first replacement, when one happened.
  pub line: Option<u32>,
  /// EDIT_NO_MATCH / EDIT_MATCH_NOT_UNIQUE, when nothing was written.
  pub reason: Option<String>,
  /// Nearby lines so the model can correct the request in one step.
  pub candidates: Vec<String>,
  /// 本次编辑前的版本 ID（若已备份）。
  #[serde(skip_serializing_if = "Option::is_none")]
  pub history_id: Option<String>,
  /// 该文件当前保留的历史版本数。
  #[serde(skip_serializing_if = "Option::is_none")]
  pub history_count: Option<u32>,
}

/// 恢复某个历史版本 payload
#[derive(Debug, Clone, Deserialize)]
pub struct RestoreVersionPayload {
  pub path: String,
  pub version_id: String,
}

/// 文件历史查询 payload
#[derive(Debug, Clone, Deserialize)]
pub struct FileHistoryPayload {
  pub path: String,
}

/// 用系统默认程序打开文件/目录 payload
#[derive(Debug, Clone, Deserialize)]
pub struct OpenPathPayload {
  pub path: String,
}

/// 一个历史版本的展示信息
#[derive(Debug, Clone, Serialize)]
pub struct FileHistoryEntry {
  pub id: String,
  pub created_at: i64,
  pub bytes: u64,
  pub tool: String,
  pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileHistoryResult {
  pub ok: bool,
  pub path: String,
  pub versions: Vec<FileHistoryEntry>,
}

/// 内容/文件名搜索 payload
#[derive(Debug, Clone, Deserialize)]
pub struct SearchFilesPayload {
  pub root: String,
  pub query: String,
  pub glob: Option<String>,
  pub limit: Option<u32>,
  pub regex: Option<bool>,
  /// content | filename | both (default both).
  pub mode: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchMatch {
  pub path: String,
  /// 1-based line number; absent for a filename match.
  pub line: Option<u32>,
  pub text: String,
  /// content | filename
  pub kind: String,
}

/// A path the walk refused to read, with the reason.
#[derive(Debug, Clone, Serialize)]
pub struct SearchSkip {
  pub path: String,
  pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchFilesResult {
  pub ok: bool,
  pub root: String,
  pub mode: String,
  pub matches: Vec<SearchMatch>,
  pub truncated: bool,
  /// True when part of the tree could not be read, so "no matches" is not
  /// the same as "nothing there".
  pub partial: bool,
  pub files_scanned: u32,
  pub skipped_count: u32,
  pub skipped: Vec<SearchSkip>,
  pub limit: u32,
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
  /// sha256 of the whole file, so an edit can prove it saw this revision.
  pub hash: String,
}

/// 设置 allowlist payload
#[derive(Debug, Clone, Deserialize)]
pub struct SetAllowlistPayload {
  pub directories: Vec<super::state::AllowlistDirectory>,
  pub version: Option<u32>,
}

/// 一次调用授权 payload：绑定 run/call，只作用于本次执行，不写入磁盘
#[derive(Debug, Clone, Deserialize)]
pub struct GrantCallScopePayload {
  pub run_id: String,
  pub call_id: Option<String>,
  pub path: String,
  #[serde(default)]
  pub read: bool,
  #[serde(default)]
  pub write: bool,
  #[serde(default)]
  pub create: bool,
  #[serde(default)]
  pub delete: bool,
}

/// 撤销一次调用授权
#[derive(Debug, Clone, Deserialize)]
pub struct RevokeCallScopePayload {
  pub run_id: String,
  pub call_id: Option<String>,
}
