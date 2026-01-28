use crate::filesystem::state::{AllowlistDirectory, AllowlistSnapshot, FilesystemAllowlistState, FsOp};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Serialize)]
pub struct FsEntry {
  pub name: String,
  pub path: String,
  #[serde(rename = "isDirectory")]
  pub is_directory: bool,
  #[serde(rename = "isFile")]
  pub is_file: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct OkResult {
  pub ok: bool,
  pub message: String,
  pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SetAllowlistPayload {
  pub directories: Vec<AllowlistDirectory>,
  pub version: Option<u32>,
}

#[tauri::command]
pub async fn filesystem_set_allowlist(
  app: AppHandle,
  state: State<'_, FilesystemAllowlistState>,
  payload: SetAllowlistPayload,
) -> Result<serde_json::Value, String> {
  let snapshot = AllowlistSnapshot {
    version: payload.version.unwrap_or(1),
    directories: payload.directories,
  };
  state.set_allowlist(&app, snapshot).await?;
  Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
pub async fn filesystem_read_file(
  app: AppHandle,
  state: State<'_, FilesystemAllowlistState>,
  path: String,
  max_lines: Option<u32>,
) -> Result<String, String> {
  let abs = state.assert_allowed(&app, &path, FsOp::Read).await?;
  let content = tokio::fs::read_to_string(&abs)
    .await
    .map_err(|e| format!("read failed: {}", e))?;

  if let Some(n) = max_lines {
    if n > 0 {
      let lines: Vec<&str> = content.split('\n').collect();
      let nn = n as usize;
      if lines.len() > nn {
        let head = lines[..nn].join("\n");
        let more = lines.len() - nn;
        return Ok(format!("{}\n... ({} more lines)", head, more));
      }
    }
  }

  Ok(content)
}

#[tauri::command]
pub async fn filesystem_write_file(
  app: AppHandle,
  state: State<'_, FilesystemAllowlistState>,
  path: String,
  content: String,
) -> Result<OkResult, String> {
  // write permission on target file
  let abs = state.assert_allowed(&app, &path, FsOp::Write).await?;
  let p = Path::new(&abs);
  if let Some(parent) = p.parent() {
    // if parent doesn't exist, require create permission (and create it)
    if tokio::fs::metadata(parent).await.is_err() {
      let parent_str = parent.to_string_lossy().to_string();
      let parent_abs = state.assert_allowed(&app, &parent_str, FsOp::Create).await?;
      tokio::fs::create_dir_all(&parent_abs)
        .await
        .map_err(|e| format!("mkdir parent failed: {}", e))?;
    }
  }

  tokio::fs::write(&abs, content)
    .await
    .map_err(|e| format!("write failed: {}", e))?;

  Ok(OkResult {
    ok: true,
    message: "File written successfully".to_string(),
    path: abs,
  })
}

#[tauri::command]
pub async fn filesystem_list_directory(
  app: AppHandle,
  state: State<'_, FilesystemAllowlistState>,
  path: String,
) -> Result<Vec<FsEntry>, String> {
  let abs = state.assert_allowed(&app, &path, FsOp::Read).await?;
  let mut rd = tokio::fs::read_dir(&abs)
    .await
    .map_err(|e| format!("read_dir failed: {}", e))?;

  let mut out: Vec<FsEntry> = Vec::new();
  while let Some(ent) = rd.next_entry().await.map_err(|e| format!("read_dir entry failed: {}", e))? {
    let fp = ent.path();
    let meta = ent.metadata().await.map_err(|e| format!("metadata failed: {}", e))?;
    let name = ent.file_name().to_string_lossy().to_string();
    out.push(FsEntry {
      name,
      path: fp.to_string_lossy().replace('\\', "/"),
      is_directory: meta.is_dir(),
      is_file: meta.is_file(),
    });
  }
  Ok(out)
}

#[tauri::command]
pub async fn filesystem_create_directory(
  app: AppHandle,
  state: State<'_, FilesystemAllowlistState>,
  path: String,
  recursive: Option<bool>,
) -> Result<serde_json::Value, String> {
  let abs = state.assert_allowed(&app, &path, FsOp::Create).await?;
  let rec = recursive.unwrap_or(true);
  if rec {
    tokio::fs::create_dir_all(&abs)
      .await
      .map_err(|e| format!("mkdir failed: {}", e))?;
  } else {
    tokio::fs::create_dir(&abs)
      .await
      .map_err(|e| format!("mkdir failed: {}", e))?;
  }
  Ok(serde_json::json!({ "ok": true, "message": "Directory created successfully", "path": abs, "recursive": rec }))
}

#[tauri::command]
pub async fn filesystem_delete_file(
  app: AppHandle,
  state: State<'_, FilesystemAllowlistState>,
  path: String,
) -> Result<OkResult, String> {
  let abs = state.assert_allowed(&app, &path, FsOp::Delete).await?;
  tokio::fs::remove_file(&abs)
    .await
    .map_err(|e| format!("delete failed: {}", e))?;
  Ok(OkResult {
    ok: true,
    message: "File deleted successfully".to_string(),
    path: abs,
  })
}

