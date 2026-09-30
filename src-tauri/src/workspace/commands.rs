//! 工作目录的 Tauri 命令。
//!
//! 所有会写到用户文件系统的动作都在这里：创建目录、写 manifest、导出、清理。
//! 校验一次分配（`workspaces/index.json` 是唯一映射），失败一律带结构化错误码返回，
//! 调用方能区分"没有这条记录"、"没有权限"和"磁盘出错"。

use crate::filesystem::state::app_data_dir;
use crate::workspace::index::{self, WorkspaceEntry};
use crate::workspace::naming::folder_name;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const MANIFEST_NAME: &str = "manifest.json";
/// 会话目录集合放在文档目录下的这个文件夹里。
const WORKSPACE_ROOT_DIR: &str = "Chatless";
/// 同名目录冲突时的最大后缀尝试次数。
const MAX_NAME_ATTEMPTS: u32 = 50;

fn now_ms() -> i64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0)
}

/// 路径一律以 `/` 分隔返回，前端只需展示和比较，不需要再处理分隔符差异。
fn to_forward_slash(path: &Path) -> String {
  let text = path.to_string_lossy().replace('\\', "/");
  text.strip_prefix("//?/").unwrap_or(&text).to_string()
}

fn create_error(what: &str, error: std::io::Error) -> String {
  match error.kind() {
    std::io::ErrorKind::PermissionDenied => {
      format!("WORKSPACE_PERMISSION_DENIED: {what}: {error}")
    }
    std::io::ErrorKind::NotFound => format!("WORKSPACE_NOT_FOUND: {what}: {error}"),
    _ => format!("WORKSPACE_CREATE_FAILED: {what}: {error}"),
  }
}

/// Case-insensitive comparable key, used to refuse "export into itself".
fn path_key(path: &Path) -> String {
  let text = to_forward_slash(path);
  if cfg!(windows) {
    text.to_lowercase()
  } else {
    text
  }
}

fn is_within_dir(dir: &Path, target: &Path) -> bool {
  let dir_key = path_key(dir);
  let target_key = path_key(target);
  let stripped = dir_key.trim_end_matches('/').to_string();
  target_key == stripped
    || target_key == dir_key
    || target_key.starts_with(&format!("{stripped}/"))
}

/// The folder the user can see their AI output in.
fn documents_root(app: &AppHandle) -> Result<PathBuf, String> {
  if let Ok(dir) = app.path().document_dir() {
    return Ok(dir);
  }
  let home = app
    .path()
    .home_dir()
    .map_err(|error| format!("WORKSPACE_CREATE_FAILED: 无法定位用户目录: {error}"))?;
  Ok(home.join("Documents"))
}

/// 旧版工作区（应用数据目录）——只在会话已经拥有它时沿用，不迁移、不删除。
fn legacy_workspace_root(data_dir: &Path, conversation_id: &str) -> PathBuf {
  data_dir.join("workspaces").join(conversation_id)
}

fn manifest_file(root: &Path) -> PathBuf {
  root.join(MANIFEST_NAME)
}

/// Writes the session manifest if it is missing. It is bookkeeping for the user,
/// not a precondition for using the directory, so a failure only logs.
async fn ensure_manifest(root: &Path, conversation_id: &str) {
  let manifest = manifest_file(root);
  if tokio::fs::metadata(&manifest).await.is_ok() {
    return;
  }
  let now = now_ms();
  let body = serde_json::json!({
    "version": 1,
    "conversationId": conversation_id,
    "createdAt": now,
    "updatedAt": now,
    "notes": "This folder holds the files this chat produced. manifest.json lists the commands and outputs.",
    "scripts": [],
    "commands": [],
    "inputs": [],
    "outputs": []
  });
  if let Err(error) = tokio::fs::write(&manifest, serde_json::to_string_pretty(&body).unwrap_or_default()).await {
    log::warn!("[workspace] 写入 manifest 失败: {error}");
  }
}

#[derive(Debug, Clone, Deserialize)]
pub struct WorkspaceEnsurePayload {
  pub conversation_id: String,
  pub title: Option<String>,
  /// 是否真的在磁盘上建出目录。默认 false：只登记"这个会话的工作目录在哪"，
  /// 纯聊天的会话因此不会在用户的文档目录里留下空文件夹。
  pub materialize: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceInfo {
  pub ok: bool,
  pub conversation_id: String,
  pub root: String,
  pub manifest_path: String,
  /// 这次调用真的建了目录。
  pub created: bool,
  /// 目录现在存在于磁盘上。false 表示这个会话还没落地过。
  pub exists: bool,
  /// True when an existing legacy directory was adopted instead of a new one.
  pub adopted_legacy: bool,
}

/// Resolves (creating when needed) the working directory for one conversation.
///
/// Order: the recorded directory → a legacy application-data directory → a new
/// folder under `Documents/Chatless`. A recorded path is never relocated, and a
/// title change never moves a directory once it exists.
///
/// With `materialize == false` this only decides and records the path: nothing is
/// created on disk. The folder appears the first time the conversation actually
/// needs it (a tool call, or the user opening/exporting the workspace).
pub async fn ensure_inner(
  data_dir: &Path,
  documents_dir: &Path,
  conversation_id: &str,
  title: Option<&str>,
  materialize: bool,
) -> Result<WorkspaceInfo, String> {
  let cid = conversation_id.trim();
  if cid.is_empty() {
    return Err("WORKSPACE_CONVERSATION_REQUIRED: 缺少会话 ID".to_string());
  }
  let mut mapping = index::load(data_dir).await;

  if let Some(entry) = mapping.get(cid).cloned() {
    let root = PathBuf::from(&entry.root);
    let mut exists = root.is_dir();
    let mut created = false;
    if !exists && materialize {
      tokio::fs::create_dir_all(&root)
        .await
        .map_err(|error| create_error("重建会话目录失败", error))?;
      exists = true;
      created = true;
    }
    let manifest = manifest_file(&root);
    if exists && materialize {
      ensure_manifest(&root, cid).await;
    }
    return Ok(WorkspaceInfo {
      ok: true,
      conversation_id: cid.to_string(),
      root: to_forward_slash(&root),
      manifest_path: to_forward_slash(&manifest),
      created,
      exists,
      adopted_legacy: false,
    });
  }

  let legacy = legacy_workspace_root(data_dir, cid);
  if legacy.is_dir() {
    if materialize {
      ensure_manifest(&legacy, cid).await;
    }
    mapping.insert(
      cid.to_string(),
      WorkspaceEntry { root: to_forward_slash(&legacy), created_at: now_ms() },
    );
    index::save(data_dir, &mapping).await?;
    return Ok(WorkspaceInfo {
      ok: true,
      conversation_id: cid.to_string(),
      root: to_forward_slash(&legacy),
      manifest_path: to_forward_slash(&manifest_file(&legacy)),
      created: false,
      exists: true,
      adopted_legacy: true,
    });
  }

  let base = documents_dir.join(WORKSPACE_ROOT_DIR);
  let name = folder_name(title.unwrap_or(""), cid);
  let mut created = false;
  let mut exists = false;
  let root = if materialize {
    tokio::fs::create_dir_all(&base)
      .await
      .map_err(|error| create_error("创建 Chatless 目录失败", error))?;
    let mut candidate = base.join(&name);
    let mut attempt = 2;
    loop {
      match tokio::fs::create_dir(&candidate).await {
        Ok(()) => {
          created = true;
          exists = true;
          break candidate;
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
          if attempt > MAX_NAME_ATTEMPTS {
            return Err(format!("WORKSPACE_CREATE_FAILED: 同名目录过多: {name}"));
          }
          candidate = base.join(format!("{name}-{attempt}"));
          attempt += 1;
        }
        Err(error) => return Err(create_error("创建会话目录失败", error)),
      }
    }
  } else {
    base.join(&name)
  };

  if materialize {
    ensure_manifest(&root, cid).await;
  }
  mapping.insert(
    cid.to_string(),
    WorkspaceEntry { root: to_forward_slash(&root), created_at: now_ms() },
  );
  index::save(data_dir, &mapping).await?;
  Ok(WorkspaceInfo {
    ok: true,
    conversation_id: cid.to_string(),
    root: to_forward_slash(&root),
    manifest_path: to_forward_slash(&manifest_file(&root)),
    created,
    exists,
    adopted_legacy: false,
  })
}

#[tauri::command]
pub async fn workspace_ensure(
  app: AppHandle,
  payload: WorkspaceEnsurePayload,
) -> Result<WorkspaceInfo, String> {
  let data_dir = app_data_dir(&app)?;
  let documents = documents_root(&app)?;
  ensure_inner(
    &data_dir,
    &documents,
    &payload.conversation_id,
    payload.title.as_deref(),
    payload.materialize.unwrap_or(false),
  )
  .await
}

#[derive(Debug, Clone, Deserialize)]
pub struct WorkspaceExportPayload {
  pub conversation_id: String,
  pub destination_dir: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceExportResult {
  pub ok: bool,
  pub source: String,
  /// 目录还没落地时为空：这个会话没有产物可导出。
  pub destination: Option<String>,
  pub files: u32,
  pub bytes: u64,
  pub skipped_symlinks: u32,
  /// 会话文件夹还不存在（这个会话从未真正用过文件）。
  pub source_missing: bool,
}

#[derive(Default)]
struct CopyStats {
  files: u32,
  bytes: u64,
  skipped_symlinks: u32,
}

fn copy_tree<'a>(
  source: &'a Path,
  destination: &'a Path,
  stats: &'a mut CopyStats,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>> {
  Box::pin(async move {
    let mut reader = tokio::fs::read_dir(source)
      .await
      .map_err(|error| format!("WORKSPACE_UNREADABLE: 读取 {} 失败: {error}", to_forward_slash(source)))?;
    while let Some(entry) = reader
      .next_entry()
      .await
      .map_err(|error| format!("WORKSPACE_UNREADABLE: 遍历 {} 失败: {error}", to_forward_slash(source)))?
    {
      let kind = entry
        .file_type()
        .await
        .map_err(|error| format!("WORKSPACE_UNREADABLE: 读取条目类型失败: {error}"))?;
      // Symlinks are counted and skipped: following them can walk outside the
      // session folder, and an export should never leak unrelated files.
      if kind.is_symlink() {
        stats.skipped_symlinks += 1;
        continue;
      }
      let from = entry.path();
      let to = destination.join(entry.file_name());
      if kind.is_dir() {
        tokio::fs::create_dir_all(&to)
          .await
          .map_err(|error| format!("WORKSPACE_EXPORT_FAILED: 创建 {} 失败: {error}", to_forward_slash(&to)))?;
        copy_tree(&from, &to, stats).await?;
      } else if kind.is_file() {
        let copied = tokio::fs::copy(&from, &to).await.map_err(|error| {
          format!("WORKSPACE_EXPORT_FAILED: 复制 {} 失败: {error}", to_forward_slash(&from))
        })?;
        stats.files += 1;
        stats.bytes += copied;
      }
    }
    Ok(())
  })
}

/// Copies one session's folder into a user-chosen directory.
///
/// The destination folder name comes from the source folder (`parent + name`),
/// never from a property the filesystem entry may not carry; an existing folder
/// gets a numeric suffix instead of being merged into or overwritten.
pub async fn export_inner(
  data_dir: &Path,
  conversation_id: &str,
  destination_dir: &str,
) -> Result<WorkspaceExportResult, String> {
  let cid = conversation_id.trim();
  if cid.is_empty() {
    return Err("WORKSPACE_CONVERSATION_REQUIRED: 缺少会话 ID".to_string());
  }
  let mapping = index::load(data_dir).await;
  let entry = mapping
    .get(cid)
    .ok_or_else(|| format!("WORKSPACE_NOT_FOUND: 没有记录会话 {cid} 的工作目录"))?;
  let source = PathBuf::from(&entry.root);
  let base = PathBuf::from(destination_dir.trim());
  if !base.is_absolute() {
    return Err("EXPORT_DESTINATION_INVALID: 导出位置必须是绝对路径".to_string());
  }
  if is_within_dir(&source, &base) {
    return Err(format!(
      "EXPORT_DESTINATION_INSIDE_SOURCE: 导出位置不能位于会话目录内部: {}",
      to_forward_slash(&base)
    ));
  }

  // 会话文件夹要等到真正用到时才创建，所以"还没建过"不是错误，而是
  // "这次没有产物可导出"。
  if !source.is_dir() {
    return Ok(WorkspaceExportResult {
      ok: true,
      source: to_forward_slash(&source),
      destination: None,
      files: 0,
      bytes: 0,
      skipped_symlinks: 0,
      source_missing: true,
    });
  }

  tokio::fs::create_dir_all(&base)
    .await
    .map_err(|error| create_error("创建导出目录失败", error))?;

  let name = source
    .file_name()
    .map(|value| value.to_string_lossy().to_string())
    .unwrap_or_else(|| "workspace".to_string());
  let mut destination = base.join(&name);
  let mut attempt = 2;
  while destination.exists() {
    if attempt > MAX_NAME_ATTEMPTS {
      return Err(format!("EXPORT_DESTINATION_CONFLICT: 目标目录已存在且无法避开: {name}"));
    }
    destination = base.join(format!("{name}-{attempt}"));
    attempt += 1;
  }
  tokio::fs::create_dir_all(&destination)
    .await
    .map_err(|error| create_error("创建导出子目录失败", error))?;

  let mut stats = CopyStats::default();
  copy_tree(&source, &destination, &mut stats).await?;
  Ok(WorkspaceExportResult {
    ok: true,
    source: to_forward_slash(&source),
    destination: Some(to_forward_slash(&destination)),
    files: stats.files,
    bytes: stats.bytes,
    skipped_symlinks: stats.skipped_symlinks,
    source_missing: false,
  })
}

#[tauri::command]
pub async fn workspace_export(
  app: AppHandle,
  payload: WorkspaceExportPayload,
) -> Result<WorkspaceExportResult, String> {
  let data_dir = app_data_dir(&app)?;
  export_inner(&data_dir, &payload.conversation_id, &payload.destination_dir).await
}

#[derive(Debug, Clone, Deserialize)]
pub struct WorkspaceIdPayload {
  pub conversation_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceTrashResult {
  pub ok: bool,
  pub conversation_id: String,
  pub path: String,
  /// False when the folder was already gone; the record is still dropped.
  pub moved_to_trash: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceTrashAllResult {
  pub ok: bool,
  pub removed: Vec<String>,
  pub failed: Vec<TrashFailure>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TrashFailure {
  pub conversation_id: String,
  pub error: String,
}

/// Moves one session folder to the system recycle bin and drops its record.
///
/// The record is only removed after the folder is actually gone, so a refused
/// deletion stays visible and can be retried instead of silently succeeding.
pub async fn trash_inner(
  data_dir: &Path,
  conversation_id: &str,
) -> Result<WorkspaceTrashResult, String> {
  let cid = conversation_id.trim();
  if cid.is_empty() {
    return Err("WORKSPACE_CONVERSATION_REQUIRED: 缺少会话 ID".to_string());
  }
  let mut mapping = index::load(data_dir).await;
  let entry = mapping
    .get(cid)
    .cloned()
    .ok_or_else(|| format!("WORKSPACE_NOT_FOUND: 没有记录会话 {cid} 的工作目录"))?;
  let root = PathBuf::from(&entry.root);
  let existed = root.exists();
  if existed {
    let target = root.clone();
    tokio::task::spawn_blocking(move || trash::delete(&target))
      .await
      .map_err(|error| format!("WORKSPACE_TRASH_FAILED: 回收站任务失败: {error}"))?
      .map_err(|error| format!("WORKSPACE_TRASH_FAILED: 移入回收站失败: {error}"))?;
  }
  mapping.remove(cid);
  index::save(data_dir, &mapping).await?;
  Ok(WorkspaceTrashResult {
    ok: true,
    conversation_id: cid.to_string(),
    path: to_forward_slash(&root),
    moved_to_trash: existed,
  })
}

#[tauri::command]
pub async fn workspace_trash(
  app: AppHandle,
  payload: WorkspaceIdPayload,
) -> Result<WorkspaceTrashResult, String> {
  let data_dir = app_data_dir(&app)?;
  trash_inner(&data_dir, &payload.conversation_id).await
}

/// Empties every recorded session folder. Per-folder failures are reported and
/// keep their record; the command itself only fails when the index cannot be read.
pub async fn trash_all_inner(data_dir: &Path) -> Result<WorkspaceTrashAllResult, String> {
  let mapping = index::load(data_dir).await;
  let mut removed: Vec<String> = Vec::new();
  let mut failed: Vec<TrashFailure> = Vec::new();
  for conversation_id in mapping.keys() {
    match trash_inner(data_dir, conversation_id).await {
      Ok(_) => removed.push(conversation_id.clone()),
      Err(error) => failed.push(TrashFailure { conversation_id: conversation_id.clone(), error }),
    }
  }
  Ok(WorkspaceTrashAllResult { ok: failed.is_empty(), removed, failed })
}

#[tauri::command]
pub async fn workspace_trash_all(app: AppHandle) -> Result<WorkspaceTrashAllResult, String> {
  let data_dir = app_data_dir(&app)?;
  trash_all_inner(&data_dir).await
}

#[tauri::command]
pub async fn workspace_reveal(
  app: AppHandle,
  payload: WorkspaceIdPayload,
) -> Result<serde_json::Value, String> {
  let data_dir = app_data_dir(&app)?;
  let documents = documents_root(&app)?;
  // 用户主动要打开这个目录，就把它建出来：显式意图，不是噪音。
  let info = ensure_inner(
    &data_dir,
    &documents,
    payload.conversation_id.trim(),
    None,
    true,
  )
  .await?;
  let root = PathBuf::from(&info.root);
  tauri_plugin_opener::reveal_item_in_dir(&root)
    .map_err(|error| format!("WORKSPACE_REVEAL_FAILED: 打开目录失败: {error}"))?;
  Ok(serde_json::json!({ "ok": true, "path": info.root }))
}

/// 会话清单只写在自己的产物目录里，绝不写进用户附加的项目目录。
async fn manifest_path_for(data_dir: &Path, conversation_id: &str) -> Result<PathBuf, String> {
  let cid = conversation_id.trim();
  if cid.is_empty() {
    return Err("WORKSPACE_CONVERSATION_REQUIRED: 缺少会话 ID".to_string());
  }
  let mapping = index::load(data_dir).await;
  let entry = mapping
    .get(cid)
    .ok_or_else(|| format!("WORKSPACE_NOT_FOUND: 没有记录会话 {cid} 的工作目录"))?;
  let root = PathBuf::from(&entry.root);
  if !root.is_dir() {
    return Err(format!("WORKSPACE_NOT_FOUND: 会话目录不存在: {}", to_forward_slash(&root)));
  }
  Ok(root.join(MANIFEST_NAME))
}

#[derive(Debug, Clone, Deserialize)]
pub struct WorkspaceManifestReadPayload {
  pub conversation_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WorkspaceManifestWritePayload {
  pub conversation_id: String,
  pub content: String,
}

/// Manifest content is bookkeeping, not a data store: refuse anything absurd
/// instead of letting one session fill the user's disk.
const MAX_MANIFEST_BYTES: usize = 2 * 1024 * 1024;

#[tauri::command]
pub async fn workspace_read_manifest(
  app: AppHandle,
  payload: WorkspaceManifestReadPayload,
) -> Result<Option<String>, String> {
  let data_dir = app_data_dir(&app)?;
  let manifest = manifest_path_for(&data_dir, &payload.conversation_id).await?;
  match tokio::fs::read_to_string(&manifest).await {
    Ok(text) => Ok(Some(text)),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
    Err(error) => Err(format!("WORKSPACE_UNREADABLE: 读取清单失败: {error}")),
  }
}

#[tauri::command]
pub async fn workspace_write_manifest(
  app: AppHandle,
  payload: WorkspaceManifestWritePayload,
) -> Result<serde_json::Value, String> {
  let data_dir = app_data_dir(&app)?;
  let manifest = manifest_path_for(&data_dir, &payload.conversation_id).await?;
  if payload.content.len() > MAX_MANIFEST_BYTES {
    return Err(format!("WORKSPACE_MANIFEST_TOO_LARGE: 清单超过 {} 字节", MAX_MANIFEST_BYTES));
  }
  let temp = manifest.with_extension("json.tmp");
  tokio::fs::write(&temp, &payload.content)
    .await
    .map_err(|error| create_error("写入清单失败", error))?;
  tokio::fs::rename(&temp, &manifest)
    .await
    .map_err(|error| create_error("替换清单失败", error))?;
  Ok(serde_json::json!({ "ok": true, "path": to_forward_slash(&manifest) }))
}

#[cfg(test)]
mod tests {
  use super::*;

  struct Sandbox {
    root: PathBuf,
    data: PathBuf,
    documents: PathBuf,
  }

  fn sandbox(tag: &str) -> Sandbox {
    let root = std::env::temp_dir().join(format!("chatless-workspace-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let data = root.join("data");
    let documents = root.join("Documents");
    std::fs::create_dir_all(&data).unwrap();
    std::fs::create_dir_all(&documents).unwrap();
    Sandbox { root, data, documents }
  }

  impl Sandbox {
    fn cleanup(&self) {
      let _ = std::fs::remove_dir_all(&self.root);
    }
  }

  #[tokio::test]
  async fn creates_finds_and_reuses_one_directory_per_conversation() {
    let sandbox = sandbox("ensure");
    let created = ensure_inner(&sandbox.data, &sandbox.documents, "conv-1", Some("线缆整改"), true).await.unwrap();
    assert!(created.created);
    assert!(created.root.ends_with("线缆整改-" ) || created.root.contains("/Chatless/线缆整改-"));
    assert!(PathBuf::from(&created.root).is_dir());

    // A second call must return the same path even though the title changed.
    let again = ensure_inner(&sandbox.data, &sandbox.documents, "conv-1", Some("换个标题"), true).await.unwrap();
    assert_eq!(again.root, created.root);
    assert!(!again.created);
    assert!(again.exists);
    sandbox.cleanup();
  }

  #[tokio::test]
  async fn resolves_a_path_without_touching_the_disk_until_it_is_needed() {
    let sandbox = sandbox("lazy");
    // First contact only decides where the workspace will live.
    let resolved = ensure_inner(&sandbox.data, &sandbox.documents, "conv-lazy", Some("New chat"), false).await.unwrap();
    assert!(!resolved.created);
    assert!(!resolved.exists);
    assert!(!PathBuf::from(&resolved.root).exists(), "a chat that never touches files leaves no folder");
    assert!(!sandbox.documents.join(WORKSPACE_ROOT_DIR).exists(), "not even the Chatless parent folder");

    // Asking again (app restart, conversation switch) still answers the same path.
    let again = ensure_inner(&sandbox.data, &sandbox.documents, "conv-lazy", Some("Renamed"), false).await.unwrap();
    assert_eq!(again.root, resolved.root);
    assert!(!again.exists);

    // The first real use creates exactly that folder, with its manifest.
    let materialized = ensure_inner(&sandbox.data, &sandbox.documents, "conv-lazy", Some("New chat"), true).await.unwrap();
    assert_eq!(materialized.root, resolved.root);
    assert!(materialized.created);
    assert!(materialized.exists);
    assert!(PathBuf::from(&materialized.manifest_path).is_file());
    sandbox.cleanup();
  }

  #[tokio::test]
  async fn exporting_a_workspace_that_was_never_used_is_empty_not_an_error() {
    let sandbox = sandbox("export-lazy");
    let resolved = ensure_inner(&sandbox.data, &sandbox.documents, "conv-empty", Some("Empty"), false).await.unwrap();
    let export_dir = sandbox.root.join("out");
    std::fs::create_dir_all(&export_dir).unwrap();

    let result = export_inner(&sandbox.data, "conv-empty", &to_forward_slash(&export_dir)).await.unwrap();
    assert!(result.source_missing);
    assert!(result.destination.is_none());
    assert_eq!(result.files, 0);
    // Nothing was created for reading either.
    assert!(!PathBuf::from(&resolved.root).exists());
    sandbox.cleanup();
  }

  #[tokio::test]
  async fn recreates_a_recorded_directory_that_was_deleted() {
    let sandbox = sandbox("recreate");
    let created = ensure_inner(&sandbox.data, &sandbox.documents, "conv-2", Some("Deleted"), true).await.unwrap();
    std::fs::remove_dir_all(&created.root).unwrap();

    // Resolving alone reports the gap without recreating anything.
    let resolved = ensure_inner(&sandbox.data, &sandbox.documents, "conv-2", Some("Deleted"), false).await.unwrap();
    assert!(!resolved.exists);
    assert!(!PathBuf::from(&resolved.root).exists());

    let again = ensure_inner(&sandbox.data, &sandbox.documents, "conv-2", Some("Deleted"), true).await.unwrap();
    assert_eq!(again.root, created.root);
    assert!(again.created, "a missing directory is reported as recreated");
    assert!(PathBuf::from(&again.root).is_dir());
    sandbox.cleanup();
  }

  #[tokio::test]
  async fn adopts_a_legacy_application_data_directory() {
    let sandbox = sandbox("legacy");
    let legacy = sandbox.data.join("workspaces").join("conv-legacy");
    std::fs::create_dir_all(&legacy).unwrap();

    let info = ensure_inner(&sandbox.data, &sandbox.documents, "conv-legacy", Some("Old"), false).await.unwrap();
    assert!(info.adopted_legacy);
    assert!(info.exists, "the legacy folder is already on disk");
    assert!(info.root.ends_with("conv-legacy"));
    assert!(!sandbox.documents.join("Chatless").exists(), "nothing new is created for an adopted folder");
    sandbox.cleanup();
  }

  #[tokio::test]
  async fn exports_nested_files_and_refuses_a_destination_inside_the_source() {
    let sandbox = sandbox("export");
    let info = ensure_inner(&sandbox.data, &sandbox.documents, "conv-3", Some("Site"), true).await.unwrap();
    let source = PathBuf::from(&info.root);
    std::fs::create_dir_all(source.join("src")).unwrap();
    std::fs::write(source.join("index.html"), "hello").unwrap();
    std::fs::write(source.join("src/app.js"), "console.log(1)").unwrap();

    let export_dir = sandbox.root.join("out");
    std::fs::create_dir_all(&export_dir).unwrap();
    let result = export_inner(&sandbox.data, "conv-3", &to_forward_slash(&export_dir)).await.unwrap();
    // index.html, src/app.js, and the session manifest that lives in the folder.
    assert_eq!(result.files, 3);
    let exported_root = PathBuf::from(result.destination.as_ref().expect("exported to a folder"));
    assert!(exported_root.join("src/app.js").is_file());
    assert!(exported_root.join(MANIFEST_NAME).is_file());

    // Exporting into the session folder itself is refused, not silently copied.
    let inside = source.join("nested");
    let refused = export_inner(&sandbox.data, "conv-3", &to_forward_slash(&inside)).await.unwrap_err();
    assert!(refused.starts_with("EXPORT_DESTINATION_INSIDE_SOURCE"), "{refused}");

    // A second export to the same place must not merge into the first one.
    let second = export_inner(&sandbox.data, "conv-3", &to_forward_slash(&export_dir)).await.unwrap();
    assert_ne!(second.destination, result.destination);
    assert_eq!(second.files, 3);
    sandbox.cleanup();
  }

  #[tokio::test]
  async fn export_requires_a_recorded_workspace() {
    let sandbox = sandbox("export-missing");
    let error = export_inner(&sandbox.data, "conv-none", &to_forward_slash(&sandbox.root))
      .await
      .unwrap_err();
    assert!(error.starts_with("WORKSPACE_NOT_FOUND"), "{error}");
    sandbox.cleanup();
  }

  #[tokio::test]
  async fn trash_removes_the_record_and_reports_when_nothing_was_there() {
    let sandbox = sandbox("trash");
    let info = ensure_inner(&sandbox.data, &sandbox.documents, "conv-4", Some("Trash me"), true).await.unwrap();
    assert!(PathBuf::from(&info.root).is_dir());

    // A folder that no longer exists still clears its record: cleanup is idempotent.
    std::fs::remove_dir_all(&info.root).unwrap();
    let result = trash_inner(&sandbox.data, "conv-4").await.unwrap();
    assert!(result.ok);
    assert!(!result.moved_to_trash);
    assert!(index::load(&sandbox.data).await.get("conv-4").is_none());

    let missing = trash_inner(&sandbox.data, "conv-4").await.unwrap_err();
    assert!(missing.starts_with("WORKSPACE_NOT_FOUND"), "{missing}");
    sandbox.cleanup();
  }

  #[tokio::test]
  async fn trash_all_reports_and_keeps_records_it_could_not_remove() {
    let sandbox = sandbox("trash-all");
    ensure_inner(&sandbox.data, &sandbox.documents, "conv-a", Some("A"), true).await.unwrap();
    let b = ensure_inner(&sandbox.data, &sandbox.documents, "conv-b", Some("B"), true).await.unwrap();
    std::fs::remove_dir_all(&b.root).unwrap();

    let result = trash_all_inner(&sandbox.data).await.unwrap();
    assert_eq!(result.removed.len(), 2);
    assert!(result.failed.is_empty());
    assert!(index::load(&sandbox.data).await.is_empty());
    sandbox.cleanup();
  }

  #[tokio::test]
  async fn a_missing_conversation_id_is_refused() {
    let sandbox = sandbox("no-id");
    let error = ensure_inner(&sandbox.data, &sandbox.documents, "  ", Some("x"), false).await.unwrap_err();
    assert!(error.starts_with("WORKSPACE_CONVERSATION_REQUIRED"), "{error}");
    sandbox.cleanup();
  }

  #[tokio::test]
  async fn the_manifest_lives_in_the_session_folder_and_round_trips() {
    let sandbox = sandbox("manifest");
    let info = ensure_inner(&sandbox.data, &sandbox.documents, "conv-m", Some("Manifest"), true).await.unwrap();
    let path = manifest_path_for(&sandbox.data, "conv-m").await.unwrap();
    assert_eq!(to_forward_slash(&path), info.manifest_path, "the recorded manifest path is the one used");
    assert!(path.is_file(), "ensure writes the initial manifest");

    // A conversation with no recorded folder cannot be written to.
    let error = manifest_path_for(&sandbox.data, "conv-none").await.unwrap_err();
    assert!(error.starts_with("WORKSPACE_NOT_FOUND"), "{error}");
    sandbox.cleanup();
  }
}
