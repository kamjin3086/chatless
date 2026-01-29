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
pub struct ReadFilePayload {
  pub path: String,
  // Back-compat: older clients send maxLines / max_lines
  #[serde(alias = "maxLines", alias = "max_lines")]
  pub max_lines: Option<u32>,
  // New: line range (1-based)
  #[serde(alias = "startLine", alias = "start_line")]
  pub start_line: Option<u32>,
  #[serde(alias = "endLine", alias = "end_line")]
  pub end_line: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReadFileResult {
  pub ok: bool,
  pub path: String,
  #[serde(rename = "totalLines")]
  pub total_lines: u32,
  #[serde(rename = "startLine")]
  pub start_line: u32,
  #[serde(rename = "endLine")]
  pub end_line: u32,
  pub content: String,
  pub truncated: bool,
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
  payload: ReadFilePayload,
) -> Result<ReadFileResult, String> {
  let abs = state
    .assert_allowed(&app, &payload.path, FsOp::Read)
    .await?;
  let content = tokio::fs::read_to_string(&abs)
    .await
    .map_err(|e| format!("read failed: {}", e))?;

  // Compute total lines (1-based counting)
  let lines: Vec<&str> = content.split('\n').collect();
  let total = lines.len() as u32;

  // Resolve range:
  // - If start/end provided: use them (clamped)
  // - Else if max_lines provided: read from 1..=max_lines
  // - Else: read the whole file
  let mut start: u32 = payload.start_line.unwrap_or(0);
  let mut end: u32 = payload.end_line.unwrap_or(0);

  if start == 0 && end == 0 {
    if let Some(n) = payload.max_lines {
      if n > 0 {
        start = 1;
        end = n;
      }
    }
  }

  if start == 0 {
    start = 1;
  }
  if end == 0 {
    end = total.max(1);
  }

  // Clamp and normalize
  if total == 0 {
    return Ok(ReadFileResult {
      ok: true,
      path: abs.replace('\\', "/"),
      total_lines: 0,
      start_line: 0,
      end_line: 0,
      content: "".to_string(),
      truncated: false,
    });
  }

  if start > total {
    start = total;
  }
  if end > total {
    end = total;
  }
  if end < start {
    end = start;
  }

  let s_idx = (start - 1) as usize;
  let e_idx = end as usize; // exclusive
  let slice = lines[s_idx..e_idx].join("\n");
  let truncated = start != 1 || end != total;

  Ok(ReadFileResult {
    ok: true,
    path: abs.replace('\\', "/"),
    total_lines: total,
    start_line: start,
    end_line: end,
    content: slice,
    truncated,
  })
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

#[tauri::command]
pub async fn filesystem_rename_file(
  app: AppHandle,
  state: State<'_, FilesystemAllowlistState>,
  old_path: String,
  new_path: String,
) -> Result<serde_json::Value, String> {
  // rename/move is a write-like operation
  let old_abs = state.assert_allowed(&app, &old_path, FsOp::Write).await?;
  let new_abs = state.assert_allowed(&app, &new_path, FsOp::Write).await?;
  tokio::fs::rename(&old_abs, &new_abs)
    .await
    .map_err(|e| format!("rename failed: {}", e))?;
  Ok(serde_json::json!({ "ok": true, "oldPath": old_abs, "newPath": new_abs }))
}

