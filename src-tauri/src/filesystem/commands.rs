use crate::filesystem::state::{
  app_data_dir, AllowlistSnapshot, FilesystemAllowlistState, FsOp, FsPermissions, CALL_SCOPE_TTL_MS,
};
use crate::filesystem::types::*;
use sha2::{Digest, Sha256};
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
/// How many refused paths are reported back with their reason.
const SEARCH_SKIP_SAMPLES: usize = 10;

fn sha256_hex(bytes: &[u8]) -> String {
  let mut hasher = Sha256::new();
  hasher.update(bytes);
  hex::encode(hasher.finalize())
}

/// Backs up a file's current content before it is overwritten.
///
/// Returns the recorded version plus the number of versions the file now has.
/// History is best-effort: if it cannot be written, the file operation still
/// proceeds (the user would rather have their edit than a failed call).
async fn record_previous_version(
  data_dir: &Path,
  abs_path: &str,
  tool: &str,
) -> Option<(crate::filesystem::history::FileVersion, u32)> {
  let existing = tokio::fs::read(abs_path).await.ok()?;
  let version = crate::filesystem::history::record_version(data_dir, abs_path, &existing, tool, None).await?;
  let count = crate::filesystem::history::list_versions(data_dir, abs_path).await.len() as u32;
  Some((version, count))
}

/// One write at a time per real path: two edits to the same file must not
/// interleave read-modify-write and silently drop one of them.
fn write_lock_for(path: &str) -> std::sync::Arc<tokio::sync::Mutex<()>> {
  use std::collections::HashMap;
  use std::sync::{Arc, Mutex, OnceLock};
  static LOCKS: OnceLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> = OnceLock::new();
  let locks = LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
  let mut guard = match locks.lock() {
    Ok(guard) => guard,
    Err(poisoned) => poisoned.into_inner(),
  };
  guard
    .entry(comparable_for_lock(path))
    .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
    .clone()
}

fn comparable_for_lock(path: &str) -> String {
  let normalized = path.replace('\\', "/").to_lowercase();
  normalized.strip_prefix("//?/").unwrap_or(&normalized).to_string()
}

/// Replace a file's contents through a sibling temp file, so a failed write
/// leaves the original intact instead of truncating it.
async fn write_file_atomically(path: &Path, content: &str) -> Result<(), String> {
  let directory = path.parent().ok_or_else(|| "目标路径没有父目录".to_string())?;
  let file_name = path
    .file_name()
    .map(|name| name.to_string_lossy().to_string())
    .unwrap_or_else(|| "file".to_string());
  let temp = directory.join(format!(".{file_name}.chatless-{}.tmp", std::process::id()));
  tokio::fs::write(&temp, content)
    .await
    .map_err(|e| format!("写入临时文件失败: {}", e))?;
  match tokio::fs::rename(&temp, path).await {
    Ok(()) => Ok(()),
    Err(error) => {
      let _ = tokio::fs::remove_file(&temp).await;
      Err(format!("替换文件失败: {}", error))
    }
  }
}

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
      candidates: closest_lines(text, find),
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

/// Lines that actually resemble the text the caller asked for, so a miss comes
/// back with something to correct against instead of the top of the file.
fn closest_lines(text: &str, find: &str) -> Vec<String> {
  let needle_lines: Vec<&str> = find
    .lines()
    .map(|line| line.trim())
    .filter(|line| !line.is_empty())
    .collect();
  let probe = needle_lines.first().copied().unwrap_or(find.trim());
  let probe_terms = similarity_terms(probe);

  let mut scored: Vec<(usize, usize, String)> = Vec::new();
  for (index, line) in text.lines().enumerate() {
    let trimmed = line.trim();
    if trimmed.is_empty() {
      continue;
    }
    let score = if probe.is_empty() {
      0
    } else if trimmed.contains(probe) || probe.contains(trimmed) {
      // A near miss on the same statement is the most useful hint of all.
      1000 + trimmed.len().min(probe.len())
    } else {
      let line_terms = similarity_terms(trimmed);
      probe_terms.intersection(&line_terms).count() * 10
    };
    if score == 0 {
      continue;
    }
    scored.push((score, index + 1, line.to_string()));
  }

  if scored.is_empty() {
    return text
      .lines()
      .enumerate()
      .filter(|(_, line)| !line.trim().is_empty())
      .take(EDIT_CANDIDATE_LINES)
      .map(|(index, line)| format!("第 {} 行: {}", index + 1, line.trim()))
      .collect();
  }

  scored.sort_by(|left, right| right.0.cmp(&left.0).then(left.1.cmp(&right.1)));
  scored
    .into_iter()
    .take(EDIT_CANDIDATE_LINES)
    .map(|(_, line, content)| {
      let trimmed = content.trim();
      let clipped: String = trimmed.chars().take(200).collect();
      format!("第 {line} 行: {clipped}")
    })
    .collect()
}

/// Cheap token set used to rank candidate lines: identifiers and short CJK runs.
fn similarity_terms(text: &str) -> std::collections::HashSet<String> {
  let mut terms = std::collections::HashSet::new();
  let mut current = String::new();
  for char in text.chars() {
    if char.is_alphanumeric() || char == '_' {
      current.push(char);
    } else {
      if current.len() > 1 {
        terms.insert(current.to_lowercase());
      }
      current.clear();
    }
  }
  if current.len() > 1 {
    terms.insert(current.to_lowercase());
  }
  terms
}

#[tauri::command]
pub async fn filesystem_set_allowlist(
  app: AppHandle,
  state: State<'_, FilesystemAllowlistState>,
  payload: SetAllowlistPayload,
) -> Result<serde_json::Value, String> {
  set_allowlist_inner(&app_data_dir(&app)?, &state, payload).await
}

/// Applies a new allowlist. Split out from the command so the authorization
/// rules can run against a plain data directory (tests, the acceptance bridge).
pub async fn set_allowlist_inner(
  data_dir: &Path,
  state: &FilesystemAllowlistState,
  payload: SetAllowlistPayload,
) -> Result<serde_json::Value, String> {
  let snapshot = AllowlistSnapshot {
    version: payload.version.unwrap_or(1),
    directories: payload.directories,
  };
  state.set_allowlist(data_dir, snapshot).await?;
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
  read_file_inner(&app_data_dir(&app)?, &state, payload).await
}

pub async fn read_file_inner(
  data_dir: &Path,
  state: &FilesystemAllowlistState,
  payload: ReadFilePayload,
) -> Result<ReadFileResult, String> {
  let abs = state
    .assert_allowed(data_dir, &payload.path, FsOp::Read)
    .await?;
  let content = tokio::fs::read_to_string(&abs)
    .await
    .map_err(|e| format!("read failed: {}", e))?;
  // The hash covers the whole file, so an edit can prove it saw this revision.
  let hash = sha256_hex(content.as_bytes());

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
      hash,
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
    hash,
  })
}

#[tauri::command]
pub async fn filesystem_edit_file(
  app: AppHandle,
  state: State<'_, FilesystemAllowlistState>,
  payload: EditFilePayload,
) -> Result<EditFileResult, String> {
  edit_file_inner(&app_data_dir(&app)?, &state, payload).await
}

pub async fn edit_file_inner(
  data_dir: &Path,
  state: &FilesystemAllowlistState,
  payload: EditFilePayload,
) -> Result<EditFileResult, String> {
  if payload.find.is_empty() {
    return Err("find 不能为空".to_string());
  }
  let abs = state.assert_allowed(data_dir, &payload.path, FsOp::Write).await?;
  // Read-modify-write under a per-path lock: two edits to the same file cannot
  // interleave and lose one of the changes.
  let lock = write_lock_for(&abs);
  let _guard = lock.lock().await;

  let bytes = tokio::fs::read(&abs)
    .await
    .map_err(|e| format!("读取文件失败: {}", e))?;
  if let Some(expected) = payload.expected_hash.as_deref().filter(|value| !value.trim().is_empty()) {
    let actual = sha256_hex(&bytes);
    if !actual.eq_ignore_ascii_case(expected.trim()) {
      return Ok(EditFileResult {
        ok: false,
        path: abs,
        replacements: 0,
        line: None,
        reason: Some("FILE_CHANGED".to_string()),
        candidates: vec![format!("文件已变化：读取时 {expected}，当前 {actual}。请重新读取后再编辑。")],
        history_id: None,
        history_count: None,
      });
    }
  }
  let text = String::from_utf8_lossy(&bytes).into_owned();

  let outcome = apply_edit(&text, &payload.find, &payload.replace, payload.all.unwrap_or(false));
  let result = match outcome {
    EditOutcome::Applied { content, replacements, line } => {
      // The pre-edit content is what "撤销这次编辑" needs.
      let history = record_previous_version(data_dir, &abs, "edit").await;
      write_file_atomically(Path::new(&abs), &content).await?;
      EditFileResult {
        ok: true,
        path: abs.clone(),
        replacements,
        line: Some(line),
        reason: None,
        candidates: Vec::new(),
        history_id: history.as_ref().map(|(version, _)| version.id.clone()),
        history_count: history.as_ref().map(|(_, count)| *count),
      }
    }
    EditOutcome::NoMatch { candidates } => EditFileResult {
      ok: false,
      path: abs.clone(),
      replacements: 0,
      line: None,
      reason: Some("EDIT_NO_MATCH".to_string()),
      candidates,
      history_id: None,
      history_count: None,
    },
    EditOutcome::NotUnique { candidates } => EditFileResult {
      ok: false,
      path: abs.clone(),
      replacements: 0,
      line: None,
      reason: Some("EDIT_MATCH_NOT_UNIQUE".to_string()),
      candidates,
      history_id: None,
      history_count: None,
    },
  };
  Ok(result)
}

#[tauri::command]
pub async fn filesystem_search_files(
  app: AppHandle,
  state: State<'_, FilesystemAllowlistState>,
  payload: SearchFilesPayload,
) -> Result<SearchFilesResult, String> {
  search_files_inner(&app_data_dir(&app)?, &state, payload).await
}

pub async fn search_files_inner(
  data_dir: &Path,
  state: &FilesystemAllowlistState,
  payload: SearchFilesPayload,
) -> Result<SearchFilesResult, String> {
  let root = state.assert_allowed(data_dir, &payload.root, FsOp::Read).await?;
  let limit = payload
    .limit
    .unwrap_or(SEARCH_DEFAULT_LIMIT)
    .clamp(1, SEARCH_MAX_LIMIT);
  let mode = match payload.mode.as_deref().unwrap_or("both").trim().to_lowercase().as_str() {
    "content" => SearchMode::Content,
    "filename" => SearchMode::Filename,
    "both" => SearchMode::Both,
    other => return Err(format!("mode 只能是 content / filename / both，收到: {other}")),
  };
  search_in_tree(&root, &payload.query, payload.glob.as_deref(), limit, payload.regex.unwrap_or(false), mode).await
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SearchMode {
  Content,
  Filename,
  Both,
}

impl SearchMode {
  fn wants_content(self) -> bool {
    matches!(self, SearchMode::Content | SearchMode::Both)
  }
  fn wants_filename(self) -> bool {
    matches!(self, SearchMode::Filename | SearchMode::Both)
  }
  fn as_str(self) -> &'static str {
    match self {
      SearchMode::Content => "content",
      SearchMode::Filename => "filename",
      SearchMode::Both => "both",
    }
  }
}

/// Walk a directory and collect matches. Pure with respect to Tauri state, so
/// the walking, skipping and limit rules are unit tested directly.
///
/// The root was already checked against the allowlist. Links are never
/// followed, so every path this walk reads is lexically inside that root and
/// cannot point at an unauthorized file.
async fn search_in_tree(
  root: &str,
  query: &str,
  glob: Option<&str>,
  limit: u32,
  use_regex: bool,
  mode: SearchMode,
) -> Result<SearchFilesResult, String> {
  let matcher = if use_regex {
    Some(regex::Regex::new(query).map_err(|e| format!("正则表达式无效: {}", e))?)
  } else {
    None
  };

  let mut matches: Vec<SearchMatch> = Vec::new();
  let mut files_scanned: u32 = 0;
  let mut skipped_count: u32 = 0;
  let mut skipped: Vec<SearchSkip> = Vec::new();
  let mut partial = false;
  let mut truncated = false;

  let root_path = Path::new(root);
  let root_meta = tokio::fs::metadata(root_path)
    .await
    .map_err(|e| format!("无法读取搜索根目录 {root}: {e}"))?;
  if !root_meta.is_dir() {
    return Err(format!("搜索根目录不是目录: {root}"));
  }

  let note_skip = |path: String, reason: &str, skipped: &mut Vec<SearchSkip>, count: &mut u32| {
    *count += 1;
    if skipped.len() < SEARCH_SKIP_SAMPLES {
      skipped.push(SearchSkip { path, reason: reason.to_string() });
    }
  };

  let mut stack = vec![std::path::PathBuf::from(&root)];

  while let Some(dir) = stack.pop() {
    let mut entries = match tokio::fs::read_dir(&dir).await {
      Ok(entries) => entries,
      Err(error) => {
        partial = true;
        note_skip(dir.to_string_lossy().to_string(), &format!("目录不可读: {error}"), &mut skipped, &mut skipped_count);
        continue;
      }
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
      let path = entry.path();
      let name = entry.file_name().to_string_lossy().to_string();
      // `file_type()` does not follow links, so a symlink or junction is
      // detected here and never traversed or read.
      let file_type = match entry.file_type().await {
        Ok(kind) => kind,
        Err(error) => {
          partial = true;
          note_skip(path.to_string_lossy().to_string(), &format!("无法判断文件类型: {error}"), &mut skipped, &mut skipped_count);
          continue;
        }
      };
      if file_type.is_symlink() {
        note_skip(path.to_string_lossy().to_string(), "符号链接/联接点已跳过", &mut skipped, &mut skipped_count);
        continue;
      }
      if file_type.is_dir() {
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
      if mode.wants_filename() && name.to_lowercase().contains(&query.to_lowercase()) {
        matches.push(SearchMatch {
          path: path.to_string_lossy().to_string(),
          line: None,
          text: name.clone(),
          kind: "filename".to_string(),
        });
        if matches.len() >= limit as usize {
          truncated = true;
          break;
        }
      }
      if !mode.wants_content() {
        continue;
      }
      let metadata = match entry.metadata().await {
        Ok(metadata) => metadata,
        Err(error) => {
          partial = true;
          note_skip(path.to_string_lossy().to_string(), &format!("无法读取元数据: {error}"), &mut skipped, &mut skipped_count);
          continue;
        }
      };
      if metadata.len() > SEARCH_MAX_FILE_BYTES {
        continue;
      }
      let bytes = match tokio::fs::read(&path).await {
        Ok(bytes) => bytes,
        Err(error) => {
          partial = true;
          note_skip(path.to_string_lossy().to_string(), &format!("无法读取: {error}"), &mut skipped, &mut skipped_count);
          continue;
        }
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
          line: Some((index + 1) as u32),
          text: line.trim().chars().take(400).collect(),
          kind: "content".to_string(),
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

  Ok(SearchFilesResult {
    ok: true,
    root: root.to_string(),
    mode: mode.as_str().to_string(),
    matches,
    truncated,
    partial,
    files_scanned,
    skipped_count,
    skipped,
    limit,
  })
}

#[tauri::command]
pub async fn filesystem_write_file(
  app: AppHandle,
  state: State<'_, FilesystemAllowlistState>,
  payload: WriteFilePayload,
) -> Result<OkResult, String> {
  write_file_inner(&app_data_dir(&app)?, &state, payload).await
}

pub async fn write_file_inner(
  data_dir: &Path,
  state: &FilesystemAllowlistState,
  payload: WriteFilePayload,
) -> Result<OkResult, String> {
  let path = payload.path;
  let content = payload.content;
  // write permission on target file
  let abs = state.assert_allowed(data_dir, &path, FsOp::Write).await?;
  let p = Path::new(&abs);
  if let Some(parent) = p.parent() {
    // if parent doesn't exist, require create permission (and create it)
    if tokio::fs::metadata(parent).await.is_err() {
      let parent_str = parent.to_string_lossy().to_string();
      let parent_abs = state.assert_allowed(data_dir, &parent_str, FsOp::Create).await?;
      tokio::fs::create_dir_all(&parent_abs)
        .await
        .map_err(|e| format!("mkdir parent failed: {}", e))?;
    }
  }

  let lock = write_lock_for(&abs);
  let _guard = lock.lock().await;
  // Keep the previous content before it is replaced: an overwrite is otherwise
  // unrecoverable.
  let history = record_previous_version(data_dir, &abs, "write").await;
  write_file_atomically(Path::new(&abs), &content).await?;

  Ok(OkResult {
    ok: true,
    message: "File written successfully".to_string(),
    path: abs,
    history_id: history.as_ref().map(|(version, _)| version.id.clone()),
    history_count: history.as_ref().map(|(_, count)| *count),
  })
}

#[tauri::command]
pub async fn filesystem_list_directory(
  app: AppHandle,
  state: State<'_, FilesystemAllowlistState>,
  payload: ListDirectoryPayload,
) -> Result<ListDirectoryResult, String> {
  list_directory_inner(&app_data_dir(&app)?, &state, payload).await
}

pub async fn list_directory_inner(
  data_dir: &Path,
  state: &FilesystemAllowlistState,
  payload: ListDirectoryPayload,
) -> Result<ListDirectoryResult, String> {
  let path = payload.path;
  let limit = payload.limit;
  let pattern = payload.pattern;
  let kind = payload.kind;
  let abs = state.assert_allowed(data_dir, &path, FsOp::Read).await?;
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

async fn delete_path_impl(data_dir: &Path, state: &FilesystemAllowlistState, path: &str) -> Result<String, String> {
  let abs = state.assert_allowed(data_dir, path, FsOp::Delete).await?;
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
  let data_dir = app_data_dir(&app)?;
  let mut deleted: Vec<String> = Vec::new();
  let mut failed: Vec<serde_json::Value> = Vec::new();
  for p in payload.paths.iter() {
    let input = String::from(p);
    match delete_path_impl(&data_dir, &state, &input).await {
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
  let data_dir = app_data_dir(&app)?;
  let dir_abs = state.assert_allowed(&data_dir, &payload.dir, FsOp::Read).await?;
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
    match delete_path_impl(&data_dir, &state, p).await {
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
  create_directory_inner(&app_data_dir(&app)?, &state, payload).await
}

pub async fn create_directory_inner(
  data_dir: &Path,
  state: &FilesystemAllowlistState,
  payload: CreateDirectoryPayload,
) -> Result<serde_json::Value, String> {
  let path = payload.path;
  let recursive = payload.recursive;
  let abs = state.assert_allowed(data_dir, &path, FsOp::Create).await?;
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
  delete_file_inner(&app_data_dir(&app)?, &state, payload).await
}

pub async fn delete_file_inner(
  data_dir: &Path,
  state: &FilesystemAllowlistState,
  payload: DeleteFilePayload,
) -> Result<OkResult, String> {
  let path = payload.path;
  let abs = state.assert_allowed(data_dir, &path, FsOp::Delete).await?;
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
    history_id: None,
    history_count: None,
  })
}

#[tauri::command]
pub async fn filesystem_rename_file(
  app: AppHandle,
  state: State<'_, FilesystemAllowlistState>,
  payload: RenameFilePayload,
) -> Result<serde_json::Value, String> {
  rename_file_inner(&app_data_dir(&app)?, &state, payload).await
}

pub async fn rename_file_inner(
  data_dir: &Path,
  state: &FilesystemAllowlistState,
  payload: RenameFilePayload,
) -> Result<serde_json::Value, String> {
  let old_path = payload.old_path;
  let new_path = payload.new_path;
  // rename/move is a write-like operation
  let old_abs = state.assert_allowed(data_dir, &old_path, FsOp::Write).await?;
  let new_abs = state.assert_allowed(data_dir, &new_path, FsOp::Write).await?;
  tokio::fs::rename(&old_abs, &new_abs)
    .await
    .map_err(|e| format!("rename failed: {}", e))?;
  Ok(serde_json::json!({ "ok": true, "oldPath": old_abs, "newPath": new_abs }))
}

/// 某个文件保留的历史版本（最新在前）。读取历史只需要该路径的读权限。
#[tauri::command]
pub async fn filesystem_file_history(
  app: AppHandle,
  state: State<'_, FilesystemAllowlistState>,
  payload: FileHistoryPayload,
) -> Result<FileHistoryResult, String> {
  file_history_inner(&app_data_dir(&app)?, &state, payload).await
}

pub async fn file_history_inner(
  data_dir: &Path,
  state: &FilesystemAllowlistState,
  payload: FileHistoryPayload,
) -> Result<FileHistoryResult, String> {
  let abs = state.assert_allowed(data_dir, &payload.path, FsOp::Read).await?;
  let versions = crate::filesystem::history::list_versions(data_dir, &abs)
    .await
    .into_iter()
    .map(|version| FileHistoryEntry {
      id: version.id,
      created_at: version.created_at,
      bytes: version.bytes,
      tool: version.tool,
      sha256: version.sha256,
    })
    .collect();
  Ok(FileHistoryResult { ok: true, path: abs, versions })
}

/// 恢复某个历史版本。恢复前会先把当前内容也备份一次，所以恢复本身可撤销。
#[tauri::command]
pub async fn filesystem_restore_file_version(
  app: AppHandle,
  state: State<'_, FilesystemAllowlistState>,
  payload: RestoreVersionPayload,
) -> Result<OkResult, String> {
  restore_version_inner(&app_data_dir(&app)?, &state, payload).await
}

pub async fn restore_version_inner(
  data_dir: &Path,
  state: &FilesystemAllowlistState,
  payload: RestoreVersionPayload,
) -> Result<OkResult, String> {
  let abs = state.assert_allowed(data_dir, &payload.path, FsOp::Write).await?;
  let lock = write_lock_for(&abs);
  let _guard = lock.lock().await;

  let content = crate::filesystem::history::read_version(data_dir, &abs, &payload.version_id).await?;
  // Snapshot what is on disk now, so "restore" is just another step in history.
  let history = record_previous_version(data_dir, &abs, "restore").await;
  let text = String::from_utf8_lossy(&content).into_owned();
  write_file_atomically(Path::new(&abs), &text).await?;

  Ok(OkResult {
    ok: true,
    message: format!("已恢复到版本 {}", payload.version_id),
    path: abs,
    history_id: history.as_ref().map(|(version, _)| version.id.clone()),
    history_count: history.as_ref().map(|(_, count)| *count),
  })
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::filesystem::state::AllowlistDirectory;

  /// End-to-end through the real commands: overwrite an existing file, see the
  /// previous content in history, restore it, and confirm the restore itself was
  /// recorded so it can be undone.
  #[tokio::test]
  async fn an_overwrite_can_be_restored_from_history() {
    let data_dir = std::env::temp_dir().join(format!("chatless-history-data-{}", std::process::id()));
    let work_dir = std::env::temp_dir().join(format!("chatless-history-work-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&data_dir);
    let _ = std::fs::remove_dir_all(&work_dir);
    std::fs::create_dir_all(&data_dir).unwrap();
    std::fs::create_dir_all(&work_dir).unwrap();

    let state = FilesystemAllowlistState::default();
    let path = work_dir.join("notes.txt").to_string_lossy().replace('\\', "/");
    set_allowlist_inner(&data_dir, &state, SetAllowlistPayload {
      version: Some(1),
      directories: vec![AllowlistDirectory {
        path: work_dir.to_string_lossy().replace('\\', "/"),
        permissions: FsPermissions { read: true, write: true, create: true, delete: false },
      }],
    })
    .await
    .expect("allowlist the work directory");

    // First write creates the file, so there is nothing to back up yet.
    let created = write_file_inner(&data_dir, &state, WriteFilePayload {
      path: path.clone(), content: "v1".to_string(),
    }).await.expect("initial write");
    assert!(created.history_id.is_none(), "a new file has no previous version");

    let overwritten = write_file_inner(&data_dir, &state, WriteFilePayload {
      path: path.clone(), content: "v2".to_string(),
    }).await.expect("overwrite");
    assert!(overwritten.history_id.is_some());
    assert_eq!(overwritten.history_count, Some(1));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "v2");

    let history = file_history_inner(&data_dir, &state, FileHistoryPayload { path: path.clone() })
      .await
      .expect("read history");
    assert_eq!(history.versions.len(), 1);
    let version_id = history.versions[0].id.clone();

    restore_version_inner(&data_dir, &state, RestoreVersionPayload {
      path: path.clone(), version_id,
    }).await.expect("restore");
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "v1");

    // The restore snapshotted v2 first, so undoing the undo is possible.
    let after = file_history_inner(&data_dir, &state, FileHistoryPayload { path })
      .await
      .expect("read history after restore");
    assert_eq!(after.versions.len(), 2);
    assert_eq!(after.versions[0].tool, "restore");

    let _ = std::fs::remove_dir_all(&data_dir);
    let _ = std::fs::remove_dir_all(&work_dir);
  }

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
  fn edit_candidates_prefer_the_lines_that_resemble_the_request() {
    let text = [
      "import { useState } from 'react';",
      "const port = 3000;",
      "const other = 1;",
      "export default App;",
    ]
    .join("\n");
    // The caller asked for a slightly different spelling of the same statement.
    match apply_edit(&text, "const port = 4000;", "const port = 5000;", false) {
      EditOutcome::NoMatch { candidates } => {
        assert!(
          candidates[0].contains("const port = 3000;"),
          "the closest line should lead the candidates: {candidates:?}",
        );
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

    let result = search_in_tree(&root.to_string_lossy(), "needle", Some("*.ts"), 10, false, SearchMode::Content)
      .await
      .expect("search");
    assert_eq!(result.matches.len(), 1, "glob + skip rules should leave one hit: {:?}", result.matches);
    assert!(result.matches[0].path.ends_with("app.ts"));
    assert_eq!(result.matches[0].kind, "content");
    assert_eq!(result.matches[0].line, Some(1));
    assert_eq!(result.mode, "content");
    assert!(!result.partial);

    let limited = search_in_tree(&root.to_string_lossy(), "needle", None, 1, false, SearchMode::Content)
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

  #[tokio::test]
  async fn search_finds_files_by_name_without_inventing_a_line() {
    let root = std::env::temp_dir().join(format!("chatless-search-name-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("checkout-flow.tsx"), "export const Checkout = () => null;\n").unwrap();
    std::fs::write(root.join("unrelated.ts"), "nothing to see\n").unwrap();

    let result = search_in_tree(&root.to_string_lossy(), "checkout", None, 50, false, SearchMode::Both)
      .await
      .expect("search");
    let name_hit = result
      .matches
      .iter()
      .find(|hit| hit.kind == "filename")
      .expect("the file name itself should match");
    assert!(name_hit.path.ends_with("checkout-flow.tsx"));
    assert_eq!(name_hit.line, None, "a filename match has no line number");

    let _ = std::fs::remove_dir_all(&root);
  }

  #[tokio::test]
  async fn search_refuses_a_root_that_is_not_a_directory() {
    let file = std::env::temp_dir().join(format!("chatless-search-file-{}.txt", std::process::id()));
    std::fs::write(&file, "content").unwrap();
    let result = search_in_tree(&file.to_string_lossy(), "content", None, 10, false, SearchMode::Both).await;
    assert!(result.is_err(), "a file root must be reported, not treated as empty");
    let _ = std::fs::remove_file(&file);
  }

  #[tokio::test]
  async fn search_never_follows_links_out_of_the_root() {
    let base = std::env::temp_dir().join(format!("chatless-search-link-{}", std::process::id()));
    let root = base.join("root");
    let outside = base.join("outside");
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(root.join("inside.txt"), "secret-in-root\n").unwrap();
    std::fs::write(outside.join("secret.txt"), "secret-outside-root\n").unwrap();

    // A link (or Windows junction) pointing at the unauthorized directory.
    let link = root.join("escape");
    let linked = link_directory(&outside, &link).await;

    let result = search_in_tree(&root.to_string_lossy(), "secret", None, 50, false, SearchMode::Content)
      .await
      .expect("search");
    assert!(
      result.matches.iter().all(|hit| hit.path.contains("inside.txt")),
      "no hit may come from outside the root: {:?}",
      result.matches,
    );
    if linked {
      assert!(result.skipped_count >= 1, "the link should be reported as skipped");
    }

    let _ = std::fs::remove_dir_all(&base);
  }

  /// Creates a directory link where the platform allows it. Returns false when
  /// the test environment cannot create one (no privilege, no symlink support).
  async fn link_directory(target: &Path, link: &Path) -> bool {
    #[cfg(windows)]
    {
      let status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
      return matches!(status, Ok(status) if status.success());
    }
    #[cfg(not(windows))]
    {
      std::os::unix::fs::symlink(target, link).is_ok()
    }
  }
}

