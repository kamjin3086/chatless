use crate::filesystem::state::{AllowlistSnapshot, FilesystemAllowlistState, FsOp, FsPermissions, CALL_SCOPE_TTL_MS};
use crate::filesystem::types::*;
use std::path::Path;
use tauri::{AppHandle, State};

/// Directories never worth scanning for a code search.
const SEARCH_SKIP_DIRS: &[&str] = &[
  ".git", "node_modules", "target", "dist", ".next", ".turbo", "venv", ".venv", "__pycache__",
];
/// Files larger than this are skipped: they are data, not source.
const SEARCH_MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const SEARCH_DEFAULT_LIMIT: u32 = 50;
const SEARCH_MAX_LIMIT: u32 = 500;
/// How many context lines an ambiguous edit returns.
const EDIT_CANDIDATE_LINES: usize = 5;

fn line_number_of(text: &str, byte_index: usize) -> u32 {
  (text[..byte_index].bytes().filter(|b| *b == b'\n').count() as u32) + 1
}

fn line_text(text: &str, line: u32) -> String {
  text.lines().nth((line.saturating_sub(1)) as usize).unwrap_or("").trim().to_string()
}

/// Minimal glob matcher: `*`, `?` and literal characters over one path segment.
fn glob_matches(pattern: &str, name: &str) -> bool {
  let pattern: Vec<char> = pattern.chars().collect();
  let name: Vec<char> = name.chars().collect();
  let (mut p, mut n) = (0_usize, 0_usize);
  let mut star: Option<(usize, usize)> = None;
  while n < name.len() {
    if p < pattern.len() && (pattern[p] == '?' || pattern[p] == name[n]) {
      p += 1;
      n += 1;
    } else if p < pattern.len() && pattern[p] == '*' {
      star = Some((p, n));
      p += 1;
    } else if let Some((star_p, star_n)) = star {
      p = star_p + 1;
      n = star_n + 1;
      star = Some((star_p, star_n + 1));
    } else {
      return false;
    }
  }
  while p < pattern.len() && pattern[p] == '*' {
    p += 1;
  }
  p == pattern.len()
}

fn looks_binary(bytes: &[u8]) -> bool {
  bytes.iter().take(8192).any(|byte| *byte == 0)
}

/// Result of a match-based edit, before it is mapped onto the command response.
enum EditOutcome {
  Applied { content: String, replacements: u32, line: u32 },
  NoMatch { candidates: Vec<String> },
  NotUnique { candidates: Vec<String> },
}

/// Pure edit semantics so the match rules can be tested without a Tauri state.
fn apply_edit(text: &str, find: &str, replace: &str, all: bool) -> EditOutcome {
  let occurrences = text.matches(find).count();
  if occurrences == 0 {
    return EditOutcome::NoMatch {
      candidates: text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .take(EDIT_CANDIDATE_LINES)
        .map(|line| line.trim().to_string())
        .collect(),
    };
  }
  if occurrences > 1 && !all {
    let mut candidates = Vec::new();
    let mut search_from = 0_usize;
    while candidates.len() < EDIT_CANDIDATE_LINES {
      let Some(offset) = text[search_from..].find(find) else { break };
      let index = search_from + offset;
      let line = line_number_of(text, index);
      candidates.push(format!("第 {line} 行: {}", line_text(text, line)));
      search_from = index + find.len();
    }
    return EditOutcome::NotUnique { candidates };
  }
  let first_index = text.find(find).unwrap_or(0);
  let content = if all { text.replace(find, replace) } else { text.replacen(find, replace, 1) };
  EditOutcome::Applied {
    content,
    replacements: if all { occurrences as u32 } else { 1 },
    line: line_number_of(text, first_index),
  }
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

/// Registers the single-call grant produced by “允许本次”. The grant stays in
/// memory, is keyed by run and call, and never edits the persisted allowlist.
#[tauri::command]
pub async fn filesystem_grant_call_scope(
  state: State<'_, FilesystemAllowlistState>,
  payload: GrantCallScopePayload,
) -> Result<serde_json::Value, String> {
  let permissions = FsPermissions {
    read: payload.read,
    write: payload.write,
    create: payload.create,
    delete: payload.delete,
  };
  let path = state
    .grant_call_scope(
      &payload.run_id,
      payload.call_id.as_deref(),
      &payload.path,
      permissions,
      CALL_SCOPE_TTL_MS,
    )
    .await?;
  Ok(serde_json::json!({ "ok": true, "path": path }))
}

#[tauri::command]
pub async fn filesystem_revoke_call_scope(
  state: State<'_, FilesystemAllowlistState>,
  payload: RevokeCallScopePayload,
) -> Result<serde_json::Value, String> {
  state
    .revoke_call_scope(&payload.run_id, payload.call_id.as_deref())
    .await?;
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
pub async fn filesystem_edit_file(
  app: AppHandle,
  state: State<'_, FilesystemAllowlistState>,
  payload: EditFilePayload,
) -> Result<EditFileResult, String> {
  if payload.find.is_empty() {
    return Err("find 不能为空".to_string());
  }
  let abs = state.assert_allowed(&app, &payload.path, FsOp::Write).await?;
  let text = tokio::fs::read_to_string(&abs)
    .await
    .map_err(|e| format!("读取文件失败: {}", e))?;

  match apply_edit(&text, &payload.find, &payload.replace, payload.all.unwrap_or(false)) {
    EditOutcome::Applied { content, replacements, line } => {
      tokio::fs::write(&abs, content)
        .await
        .map_err(|e| format!("写入文件失败: {}", e))?;
      Ok(EditFileResult {
        ok: true,
        path: abs,
        replacements,
        line: Some(line),
        reason: None,
        candidates: Vec::new(),
      })
    }
    EditOutcome::NoMatch { candidates } => Ok(EditFileResult {
      ok: false,
      path: abs,
      replacements: 0,
      line: None,
      reason: Some("EDIT_NO_MATCH".to_string()),
      candidates,
    }),
    EditOutcome::NotUnique { candidates } => Ok(EditFileResult {
      ok: false,
      path: abs,
      replacements: 0,
      line: None,
      reason: Some("EDIT_MATCH_NOT_UNIQUE".to_string()),
      candidates,
    }),
  }
}

#[tauri::command]
pub async fn filesystem_search_files(
  app: AppHandle,
  state: State<'_, FilesystemAllowlistState>,
  payload: SearchFilesPayload,
) -> Result<SearchFilesResult, String> {
  let root = state.assert_allowed(&app, &payload.root, FsOp::Read).await?;
  let limit = payload
    .limit
    .unwrap_or(SEARCH_DEFAULT_LIMIT)
    .clamp(1, SEARCH_MAX_LIMIT);
  search_in_tree(&root, &payload.query, payload.glob.as_deref(), limit, payload.regex.unwrap_or(false)).await
}

/// Walk a directory and collect line matches.  Pure with respect to Tauri state,
/// so the walking, skipping and limit rules are unit tested directly.
async fn search_in_tree(
  root: &str,
  query: &str,
  glob: Option<&str>,
  limit: u32,
  use_regex: bool,
) -> Result<SearchFilesResult, String> {
  let matcher = if use_regex {
    Some(regex::Regex::new(query).map_err(|e| format!("正则表达式无效: {}", e))?)
  } else {
    None
  };

  let mut matches: Vec<SearchMatch> = Vec::new();
  let mut files_scanned: u32 = 0;
  let mut truncated = false;
  let mut stack = vec![std::path::PathBuf::from(&root)];

  while let Some(dir) = stack.pop() {
    let mut entries = match tokio::fs::read_dir(&dir).await {
      Ok(entries) => entries,
      Err(_) => continue,
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
      let path = entry.path();
      let name = entry.file_name().to_string_lossy().to_string();
      let is_dir = entry.file_type().await.map(|kind| kind.is_dir()).unwrap_or(false);
      if is_dir {
        if SEARCH_SKIP_DIRS.iter().any(|skip| skip.eq_ignore_ascii_case(&name)) {
          continue;
        }
        stack.push(path);
        continue;
      }
      if let Some(glob) = glob.filter(|glob| !glob.trim().is_empty()) {
        if !glob_matches(glob, &name) {
          continue;
        }
      }
      let metadata = match entry.metadata().await {
        Ok(metadata) => metadata,
        Err(_) => continue,
      };
      if metadata.len() > SEARCH_MAX_FILE_BYTES {
        continue;
      }
      let bytes = match tokio::fs::read(&path).await {
        Ok(bytes) => bytes,
        Err(_) => continue,
      };
      if looks_binary(&bytes) {
        continue;
      }
      files_scanned += 1;
      let text = String::from_utf8_lossy(&bytes);
      for (index, line) in text.lines().enumerate() {
        let hit = match matcher {
          Some(ref regex) => regex.is_match(line),
          None => line.contains(query),
        };
        if !hit {
          continue;
        }
        matches.push(SearchMatch {
          path: path.to_string_lossy().to_string(),
          line: (index + 1) as u32,
          text: line.trim().chars().take(400).collect(),
        });
        if matches.len() >= limit as usize {
          truncated = true;
          break;
        }
      }
      if truncated {
        break;
      }
    }
    if truncated {
      break;
    }
  }

  Ok(SearchFilesResult { ok: true, root: root.to_string(), matches, truncated, files_scanned, limit })
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

#[cfg(test)]
mod tests {
  use super::*;

  fn applied(outcome: EditOutcome) -> (String, u32, u32) {
    match outcome {
      EditOutcome::Applied { content, replacements, line } => (content, replacements, line),
      other => panic!("expected an applied edit, got {}", match other {
        EditOutcome::NoMatch { .. } => "no match",
        EditOutcome::NotUnique { .. } => "not unique",
        EditOutcome::Applied { .. } => unreachable!(),
      }),
    }
  }

  #[test]
  fn edit_replaces_a_unique_match_and_reports_the_line() {
    let text = "line one\nconst port = 3000;\nline three\n";
    let (content, replacements, line) = applied(apply_edit(text, "const port = 3000;", "const port = 4000;", false));

    assert_eq!(content, "line one\nconst port = 4000;\nline three\n");
    assert_eq!(replacements, 1);
    assert_eq!(line, 2);
  }

  #[test]
  fn edit_refuses_an_ambiguous_match_and_lists_candidates() {
    let text = "useEffect();\nconst x = 1;\nuseEffect();\n";
    match apply_edit(text, "useEffect();", "effect();", false) {
      EditOutcome::NotUnique { candidates } => {
        assert_eq!(candidates.len(), 2);
        assert!(candidates[0].contains("第 1 行"));
        assert!(candidates[1].contains("第 3 行"));
      }
      _ => panic!("an ambiguous edit must not be applied"),
    }
  }

  #[test]
  fn edit_with_all_replaces_every_occurrence() {
    let text = "a\na\na\n";
    let (content, replacements, _) = applied(apply_edit(text, "a", "b", true));

    assert_eq!(content, "b\nb\nb\n");
    assert_eq!(replacements, 3);
  }

  #[test]
  fn edit_reports_a_miss_with_nearby_lines() {
    let text = "first line\nsecond line\n";
    match apply_edit(text, "missing text", "x", false) {
      EditOutcome::NoMatch { candidates } => {
        assert!(candidates.iter().any(|line| line.contains("first line")));
      }
      _ => panic!("a missing match must not be applied"),
    }
  }

  #[test]
  fn glob_matches_names_not_paths() {
    assert!(glob_matches("*.ts", "app.ts"));
    assert!(glob_matches("Button?tsx", "Button.tsx"));
    assert!(!glob_matches("*.ts", "app.tsx"));
    assert!(glob_matches("*", "anything"));
  }

  #[tokio::test]
  async fn search_skips_heavy_dirs_and_binaries_and_respects_the_limit() {
    let root = std::env::temp_dir().join(format!("chatless-search-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("node_modules")).unwrap();
    std::fs::write(root.join("app.ts"), "const needle = 1;\nconst other = 2;\n").unwrap();
    std::fs::write(root.join("readme.md"), "needle in docs\nneedle again\n").unwrap();
    std::fs::write(root.join("node_modules").join("dep.ts"), "needle in a dependency\n").unwrap();
    std::fs::write(root.join("blob.bin"), [0_u8, b'n', b'e', b'e', b'd', b'l', b'e']).unwrap();

    let result = search_in_tree(&root.to_string_lossy(), "needle", Some("*.ts"), 10, false)
      .await
      .expect("search");
    assert_eq!(result.matches.len(), 1, "glob + skip rules should leave one hit: {:?}", result.matches);
    assert!(result.matches[0].path.ends_with("app.ts"));

    let limited = search_in_tree(&root.to_string_lossy(), "needle", None, 1, false)
      .await
      .expect("search");
    assert_eq!(limited.matches.len(), 1);
    assert!(limited.truncated);
    assert!(
      !limited.matches.iter().any(|m| m.path.contains("node_modules")),
      "node_modules must be skipped",
    );

    let _ = std::fs::remove_dir_all(&root);
  }
}

