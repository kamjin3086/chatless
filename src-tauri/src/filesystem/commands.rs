use crate::filesystem::state::{AllowlistSnapshot, FilesystemAllowlistState, FsOp};
use crate::filesystem::types::*;
use std::path::Path;
use tauri::{AppHandle, State};

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
  payload: WriteFilePayload,
) -> Result<OkResult, String> {
  let path = payload.path;
  let content = payload.content;
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
  payload: ListDirectoryPayload,
) -> Result<ListDirectoryResult, String> {
  let path = payload.path;
  let limit = payload.limit;
  let pattern = payload.pattern;
  let kind = payload.kind;
  let abs = state.assert_allowed(&app, &path, FsOp::Read).await?;
  let mut rd = tokio::fs::read_dir(&abs)
    .await
    .map_err(|e| format!("read_dir failed: {}", e))?;

  // 安全/体验：默认限制返回条目数，避免一次性把巨量目录塞进 AI 上下文。
  // - 允许用户显式传入更大 limit，但设置硬上限防止内存/日志爆炸。
  const DEFAULT_LIMIT: u32 = 200;
  const HARD_MAX_LIMIT: u32 = 2000;
  let mut eff_limit = limit.unwrap_or(DEFAULT_LIMIT);
  if eff_limit == 0 {
    eff_limit = DEFAULT_LIMIT;
  }
  if eff_limit > HARD_MAX_LIMIT {
    eff_limit = HARD_MAX_LIMIT;
  }

  let mut out: Vec<FsEntry> = Vec::new();
  let mut truncated = false;
  let kind = kind.unwrap_or_else(|| "any".to_string()).to_lowercase();
  while let Some(ent) = rd.next_entry().await.map_err(|e| format!("read_dir entry failed: {}", e))? {
    // 读到 limit+1 以判断是否还有更多
    if out.len() as u32 >= eff_limit + 1 {
      truncated = true;
      break;
    }
    let fp = ent.path();
    let name = ent.file_name().to_string_lossy().to_string();
    if let Some(ref ptn) = pattern {
      if !wildcard_match(ptn, &name) {
        continue;
      }
    }

    // 性能：先按 name 过滤，再取 file_type（比 metadata 更轻量）
    let ft = ent.file_type().await.map_err(|e| format!("metadata failed: {}", e))?;
    let is_dir = ft.is_dir();
    let is_file = ft.is_file();
    if kind == "dir" && !is_dir {
      continue;
    }
    if kind == "file" && !is_file {
      continue;
    }
    out.push(FsEntry {
      name,
      path: fp.to_string_lossy().replace('\\', "/"),
      is_directory: is_dir,
      is_file: is_file,
    });
  }

  if out.len() as u32 > eff_limit {
    out.truncate(eff_limit as usize);
    truncated = true;
  }

  Ok(ListDirectoryResult {
    ok: true,
    path: abs.replace('\\', "/"),
    returned_count: out.len() as u32,
    entries: out,
    truncated,
    limit: eff_limit,
  })
}

fn wildcard_match(pattern: &str, text: &str) -> bool {
  // 简单通配符：
  // - '*' 匹配任意长度（含空）
  // - '?' 匹配任意单字符
  let p = pattern.as_bytes();
  let t = text.as_bytes();
  let mut pi: usize = 0;
  let mut ti: usize = 0;
  let mut star_pi: Option<usize> = None;
  let mut star_ti: usize = 0;

  while ti < t.len() {
    if pi < p.len() && (p[pi] == b'?' || p[pi] == t[ti]) {
      pi += 1;
      ti += 1;
      continue;
    }
    if pi < p.len() && p[pi] == b'*' {
      star_pi = Some(pi);
      pi += 1;
      star_ti = ti;
      continue;
    }
    if let Some(sp) = star_pi {
      pi = sp + 1;
      star_ti += 1;
      ti = star_ti;
      continue;
    }
    return false;
  }

  while pi < p.len() && p[pi] == b'*' {
    pi += 1;
  }
  pi == p.len()
}

async fn delete_path_impl(app: &AppHandle, state: &FilesystemAllowlistState, path: &str) -> Result<String, String> {
  let abs = state.assert_allowed(app, path, FsOp::Delete).await?;
  let meta = tokio::fs::metadata(&abs).await.map_err(|e| format!("delete failed: {}", e))?;
  if meta.is_dir() {
    tokio::fs::remove_dir_all(&abs).await.map_err(|e| format!("delete failed: {}", e))?;
  } else {
    tokio::fs::remove_file(&abs).await.map_err(|e| format!("delete failed: {}", e))?;
  }
  Ok(abs)
}

#[tauri::command]
pub async fn filesystem_delete_many(
  app: AppHandle,
  state: State<'_, FilesystemAllowlistState>,
  payload: DeleteManyPayload,
) -> Result<serde_json::Value, String> {
  let mut deleted: Vec<String> = Vec::new();
  let mut failed: Vec<serde_json::Value> = Vec::new();
  for p in payload.paths.iter() {
    let input = String::from(p);
    match delete_path_impl(&app, &state, &input).await {
      Ok(abs) => deleted.push(abs.replace('\\', "/")),
      Err(e) => failed.push(serde_json::json!({ "path": input.replace('\\', "/"), "error": e })),
    }
  }
  Ok(serde_json::json!({
    "ok": failed.is_empty(),
    "deletedCount": deleted.len(),
    "failedCount": failed.len(),
    "deleted": deleted,
    "failed": failed
  }))
}

#[tauri::command]
pub async fn filesystem_delete_by_pattern(
  app: AppHandle,
  state: State<'_, FilesystemAllowlistState>,
  payload: DeleteByPatternPayload,
) -> Result<serde_json::Value, String> {
  let dir_abs = state.assert_allowed(&app, &payload.dir, FsOp::Read).await?;
  // 默认限制，防止误删/误匹配太多
  const DEFAULT_LIMIT: u32 = 200;
  const HARD_MAX_LIMIT: u32 = 2000;
  let mut eff_limit = payload.limit.unwrap_or(DEFAULT_LIMIT);
  if eff_limit == 0 { eff_limit = DEFAULT_LIMIT; }
  if eff_limit > HARD_MAX_LIMIT { eff_limit = HARD_MAX_LIMIT; }

  let mut rd = tokio::fs::read_dir(&dir_abs).await.map_err(|e| format!("read_dir failed: {}", e))?;
  let mut targets: Vec<String> = Vec::new();
  let kind = payload.kind.clone().unwrap_or_else(|| "any".to_string()).to_lowercase();
  while let Some(ent) = rd.next_entry().await.map_err(|e| format!("read_dir entry failed: {}", e))? {
    if targets.len() as u32 >= eff_limit + 1 { break; }
    let name = ent.file_name().to_string_lossy().to_string();
    if !wildcard_match(&payload.pattern, &name) { continue; }
    let ft = ent.file_type().await.map_err(|e| format!("metadata failed: {}", e))?;
    if kind == "dir" && !ft.is_dir() { continue; }
    if kind == "file" && !ft.is_file() { continue; }
    let fp = ent.path().to_string_lossy().replace('\\', "/");
    targets.push(fp);
  }
  let truncated = targets.len() as u32 > eff_limit;
  if truncated { targets.truncate(eff_limit as usize); }

  const DEFAULT_DRY_RUN: bool = false;
  let dry_run = payload.dry_run.unwrap_or(DEFAULT_DRY_RUN);
  if dry_run {
    return Ok(serde_json::json!({
      "ok": true,
      "dryRun": true,
      "dir": dir_abs.replace('\\', "/"),
      "pattern": payload.pattern,
      "kind": kind,
      "limit": eff_limit,
      "truncated": truncated,
      "matchedCount": targets.len(),
      "matches": targets
    }));
  }

  let mut deleted: Vec<String> = Vec::new();
  let mut failed: Vec<serde_json::Value> = Vec::new();
  for p in targets.iter() {
    match delete_path_impl(&app, &state, p).await {
      Ok(abs) => deleted.push(abs.replace('\\', "/")),
      Err(e) => failed.push(serde_json::json!({ "path": p, "error": e })),
    }
  }

  Ok(serde_json::json!({
    "ok": failed.is_empty(),
    "dryRun": false,
    "dir": dir_abs.replace('\\', "/"),
    "pattern": payload.pattern,
    "kind": kind,
    "limit": eff_limit,
    "truncated": truncated,
    "matchedCount": deleted.len() + failed.len(),
    "deletedCount": deleted.len(),
    "failedCount": failed.len(),
    "deleted": deleted,
    "failed": failed
  }))
}

#[tauri::command]
pub async fn filesystem_create_directory(
  app: AppHandle,
  state: State<'_, FilesystemAllowlistState>,
  payload: CreateDirectoryPayload,
) -> Result<serde_json::Value, String> {
  let path = payload.path;
  let recursive = payload.recursive;
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
  payload: DeleteFilePayload,
) -> Result<OkResult, String> {
  let path = payload.path;
  let abs = state.assert_allowed(&app, &path, FsOp::Delete).await?;
  let meta = tokio::fs::metadata(&abs)
    .await
    .map_err(|e| format!("delete failed: {}", e))?;

  if meta.is_dir() {
    // 目录：递归删除
    tokio::fs::remove_dir_all(&abs)
      .await
      .map_err(|e| format!("delete failed: {}", e))?;
  } else {
    // 文件：删除文件
    tokio::fs::remove_file(&abs)
      .await
      .map_err(|e| format!("delete failed: {}", e))?;
  }
  Ok(OkResult {
    ok: true,
    message: "Path deleted successfully".to_string(),
    path: abs,
  })
}

#[tauri::command]
pub async fn filesystem_rename_file(
  app: AppHandle,
  state: State<'_, FilesystemAllowlistState>,
  payload: RenameFilePayload,
) -> Result<serde_json::Value, String> {
  let old_path = payload.old_path;
  let new_path = payload.new_path;
  // rename/move is a write-like operation
  let old_abs = state.assert_allowed(&app, &old_path, FsOp::Write).await?;
  let new_abs = state.assert_allowed(&app, &new_path, FsOp::Write).await?;
  tokio::fs::rename(&old_abs, &new_abs)
    .await
    .map_err(|e| format!("rename failed: {}", e))?;
  Ok(serde_json::json!({ "ok": true, "oldPath": old_abs, "newPath": new_abs }))
}

