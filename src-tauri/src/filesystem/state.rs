use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri::Manager;
use tokio::sync::RwLock;

/// A one-time approval lives in memory only. It is bound to the run and call
/// that asked for it, so another conversation cannot share it and it never
/// reaches the persisted allowlist file.
pub const CALL_SCOPE_TTL_MS: i64 = 10 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FsPermissions {
  pub read: bool,
  pub write: bool,
  pub create: bool,
  pub delete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllowlistDirectory {
  pub path: String,
  pub permissions: FsPermissions,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AllowlistSnapshot {
  pub version: u32,
  pub directories: Vec<AllowlistDirectory>,
}

#[derive(Debug, Clone)]
pub struct CallScopedGrant {
  pub run_id: String,
  pub call_id: Option<String>,
  pub lexical_path: String,
  pub real_path: String,
  pub permissions: FsPermissions,
  pub expires_at_ms: i64,
}

#[derive(Default)]
pub struct FilesystemAllowlistState {
  loaded: AtomicBool,
  inner: RwLock<AllowlistSnapshot>,
  grants: RwLock<Vec<CallScopedGrant>>,
}

#[derive(Debug, Clone, Copy)]
pub enum FsOp {
  Read,
  Write,
  Create,
  Delete,
}

fn now_ms() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0)
}

fn normalize_slashes(p: &str) -> String {
  p.trim().replace('\\', "/")
}

/// Drops the Windows verbatim prefix so `\\?\C:\x` compares equal to `C:/x`.
fn strip_verbatim(p: &str) -> String {
  let s = p.replace('\\', "/");
  if let Some(rest) = s.strip_prefix("//?/UNC/") {
    return format!("//{}", rest);
  }
  if let Some(rest) = s.strip_prefix("//?/") {
    return rest.to_string();
  }
  s
}

fn is_windows_drive_path(p: &str) -> bool {
  let s = p.as_bytes();
  s.len() >= 3 && s[1] == b':' && s[2] == b'/'
}

fn split_root(s: &str) -> Result<(String, String), String> {
  if let Some(rest) = s.strip_prefix("//") {
    let mut parts = rest.splitn(3, '/');
    let server = parts.next().unwrap_or("");
    let share = parts.next().unwrap_or("");
    if server.is_empty() || share.is_empty() {
      return Err("invalid UNC path".to_string());
    }
    return Ok((format!("//{}/{}", server, share), parts.next().unwrap_or("").to_string()));
  }
  if s.len() >= 2 && s.as_bytes()[1] == b':' {
    return Ok((s[..2].to_string(), s[2..].to_string()));
  }
  if s.starts_with('/') {
    return Ok(("/".to_string(), s[1..].to_string()));
  }
  Err("absolute path is required".to_string())
}

/// Lexical normalization that resolves `.` and `..` without touching the disk.
/// Collapsing `..` here is what stops `C:/work/../../secret` from being treated
/// as if it lived inside the authorized directory.
fn normalize_abs_path(p: &str) -> Result<String, String> {
  let s = normalize_slashes(p);
  if s.is_empty() {
    return Err("path is required".to_string());
  }
  if s.contains("://") {
    return Err("protocol path is not allowed".to_string());
  }
  let is_abs = s.starts_with('/')
    || (s.len() >= 3 && s.as_bytes()[1] == b':' && (s.as_bytes()[2] == b'/' || s.as_bytes()[2] == b'\\'));
  if !is_abs {
    return Err("absolute path is required".to_string());
  }
  let (root, rest) = split_root(&s)?;
  let mut stack: Vec<&str> = Vec::new();
  for part in rest.split('/') {
    match part {
      "" | "." => continue,
      ".." => {
        if stack.pop().is_none() {
          return Err(format!("path escapes its root: {}", s));
        }
      }
      other => stack.push(other),
    }
  }
  let joined = stack.join("/");
  let trimmed_root = root.trim_end_matches('/');
  if joined.is_empty() {
    if trimmed_root.is_empty() {
      return Ok("/".to_string());
    }
    return Ok(format!("{}/", trimmed_root));
  }
  if trimmed_root.is_empty() {
    return Ok(format!("/{}", joined));
  }
  Ok(format!("{}/{}", trimmed_root, joined))
}

fn comparable(p: &str) -> String {
  let s = strip_verbatim(p);
  if is_windows_drive_path(&s) || s.starts_with("//") {
    s.to_lowercase()
  } else {
    s
  }
}

fn is_within_dir(dir: &str, path: &str) -> bool {
  let d = comparable(dir);
  let p = comparable(path);
  if p == d {
    return true;
  }
  // A root entry such as `C:/` already ends with its separator.
  let prefix = if d.ends_with('/') { d } else { format!("{}/", d) };
  p.starts_with(&prefix)
}

/// Resolves the on-disk location of a path whose leaf may not exist yet, so
/// junctions and symlinks anywhere along the way are followed before the
/// allowlist comparison happens.
async fn resolve_real_path(lexical: &str) -> String {
  let mut tail: Vec<String> = Vec::new();
  let mut current = Path::new(lexical).to_path_buf();
  loop {
    if let Ok(canonical) = tokio::fs::canonicalize(&current).await {
      let mut real = strip_verbatim(&canonical.to_string_lossy());
      for part in tail.iter().rev() {
        while real.ends_with('/') {
          real.pop();
        }
        real.push('/');
        real.push_str(part);
      }
      return real;
    }
    match current.parent() {
      Some(parent) if parent != current && !parent.as_os_str().is_empty() => {
        if let Some(name) = current.file_name() {
          tail.push(name.to_string_lossy().to_string());
        }
        current = parent.to_path_buf();
      }
      _ => return lexical.to_string(),
    }
  }
}

fn op_allowed(perm: &FsPermissions, op: FsOp) -> bool {
  match op {
    FsOp::Read => perm.read,
    FsOp::Write => perm.write,
    FsOp::Create => perm.create,
    FsOp::Delete => perm.delete,
  }
}

/// A directory entry authorizes a path only when both the lexical path and the
/// resolved path live inside it. The lexical check keeps an authorized
/// directory that is itself a symlink usable; the resolved check stops a
/// junction inside an authorized directory from reaching outside it.
async fn best_match_for_op<'a>(
  dirs: &'a [AllowlistDirectory],
  lexical: &str,
  real: &str,
  op: Option<FsOp>,
) -> Option<&'a AllowlistDirectory> {
  let mut best: Option<&AllowlistDirectory> = None;
  let mut best_len: usize = 0;
  for d in dirs {
    if let Some(op) = op {
      if !op_allowed(&d.permissions, op) {
        continue;
      }
    }
    if !is_within_dir(&d.path, lexical) {
      continue;
    }
    let entry_real = resolve_real_path(&d.path).await;
    if !is_within_dir(&entry_real, real) {
      continue;
    }
    let l = d.path.len();
    if l >= best_len {
      best = Some(d);
      best_len = l;
    }
  }
  best
}

/// Where the persisted allowlist lives. Taking the directory instead of an
/// `AppHandle` keeps the authorization rules usable outside a running app.
fn storage_path(data_dir: &Path) -> PathBuf {
  data_dir.join("filesystem-allowlist.json")
}

/// The app data directory every filesystem command resolves window-scoped paths
/// against.
pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
  app.path()
    .app_data_dir()
    .map_err(|e| format!("resolve app_data_dir failed: {}", e))
}

async fn ensure_parent_dir(p: &Path) -> Result<(), String> {
  if let Some(parent) = p.parent() {
    tokio::fs::create_dir_all(parent)
      .await
      .map_err(|e| format!("create parent dir failed: {}", e))?;
  }
  Ok(())
}

impl FilesystemAllowlistState {
  pub async fn ensure_loaded(&self, data_dir: &Path) -> Result<(), String> {
    if self.loaded.load(Ordering::SeqCst) {
      return Ok(());
    }
    // best-effort load; if file missing, treat as empty allowlist
    let p = storage_path(data_dir);
    let snapshot = match tokio::fs::read_to_string(&p).await {
      Ok(s) => serde_json::from_str::<AllowlistSnapshot>(&s).unwrap_or_default(),
      Err(_) => AllowlistSnapshot::default(),
    };
    {
      let mut w = self.inner.write().await;
      *w = snapshot;
    }
    self.loaded.store(true, Ordering::SeqCst);
    Ok(())
  }

  pub async fn set_allowlist(&self, data_dir: &Path, mut snapshot: AllowlistSnapshot) -> Result<(), String> {
    // normalize paths
    for d in snapshot.directories.iter_mut() {
      d.path = normalize_abs_path(&d.path)?;
    }
    snapshot.version = snapshot.version.max(1);

    {
      let mut w = self.inner.write().await;
      *w = snapshot.clone();
    }

    let p = storage_path(data_dir);
    ensure_parent_dir(&p).await?;
    tokio::fs::write(&p, serde_json::to_string_pretty(&snapshot).unwrap_or_else(|_| "{}".to_string()))
      .await
      .map_err(|e| format!("persist allowlist failed: {}", e))?;

    self.loaded.store(true, Ordering::SeqCst);
    Ok(())
  }

  /// Registers an execution-scoped grant for one approved call. Nothing is
  /// written to disk and nothing outlives the run that asked for it.
  pub async fn grant_call_scope(
    &self,
    run_id: &str,
    call_id: Option<&str>,
    path: &str,
    permissions: FsPermissions,
    ttl_ms: i64,
  ) -> Result<String, String> {
    let lexical = normalize_abs_path(path)?;
    let real = resolve_real_path(&lexical).await;
    let mut grants = self.grants.write().await;
    let now = now_ms();
    grants.retain(|g| g.expires_at_ms > now);
    grants.push(CallScopedGrant {
      run_id: run_id.to_string(),
      call_id: call_id.map(|s| s.to_string()),
      lexical_path: lexical.clone(),
      real_path: real,
      permissions,
      expires_at_ms: now + ttl_ms.max(1000),
    });
    Ok(lexical)
  }

  pub async fn revoke_call_scope(&self, run_id: &str, call_id: Option<&str>) -> Result<(), String> {
    let mut grants = self.grants.write().await;
    grants.retain(|g| !(g.run_id == run_id && (call_id.is_none() || g.call_id.as_deref() == call_id)));
    Ok(())
  }

  pub async fn assert_allowed(&self, data_dir: &Path, input_path: &str, op: FsOp) -> Result<String, String> {
    self.ensure_loaded(data_dir).await?;
    let abs = normalize_abs_path(input_path)?;
    let real = resolve_real_path(&abs).await;

    {
      let snap = self.inner.read().await;
      // 关键：选择“最具体且允许该 op 的目录”
      // 这样不会出现“更具体目录条目（仅 delete=true）意外覆盖父目录 read 权限，导致 ls 永远 forbidden”的问题。
      if best_match_for_op(&snap.directories, &abs, &real, Some(op)).await.is_some() {
        return Ok(abs);
      }
    }

    {
      let mut grants = self.grants.write().await;
      let now = now_ms();
      grants.retain(|g| g.expires_at_ms > now);
      if grants.iter().any(|g| {
        op_allowed(&g.permissions, op)
          && is_within_dir(&g.lexical_path, &abs)
          && is_within_dir(&g.real_path, &real)
      }) {
        return Ok(abs);
      }
    }

    // 无任何目录允许该 op：给出可诊断信息（匹配到哪个目录、其权限是什么）
    let snap = self.inner.read().await;
    let m = best_match_for_op(&snap.directories, &abs, &real, None)
      .await
      .ok_or_else(|| format!("forbidden path: {} (resolved: {})", abs, real))?;
    Err(format!(
      "forbidden op for path: {} (resolved: {}, matched allowlist: {}, perms: read={}, write={}, create={}, delete={})",
      abs,
      real,
      m.path,
      m.permissions.read,
      m.permissions.write,
      m.permissions.create,
      m.permissions.delete
    ))
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn collapses_traversal_segments_lexically() {
    assert_eq!(normalize_abs_path("C:\\work\\..\\secret").unwrap(), "C:/secret");
    assert_eq!(normalize_abs_path("C:/work/sub/../file.txt").unwrap(), "C:/work/file.txt");
    // Trailing separators are trimmed; only a real root keeps its separator.
    assert_eq!(normalize_abs_path("C:\\work\\\\").unwrap(), "C:/work");
    assert_eq!(normalize_abs_path("C:\\").unwrap(), "C:/");
    assert_eq!(normalize_abs_path("/a/b/../c").unwrap(), "/a/c");
    // Climbing above the root is refused outright instead of being clamped.
    assert!(normalize_abs_path("C:\\work\\..\\..\\secret").is_err());
    assert!(normalize_abs_path("C:/..").is_err());
    assert!(normalize_abs_path("relative/path").is_err());
  }

  #[test]
  fn compares_verbatim_and_plain_paths_as_equal() {
    assert!(is_within_dir("C:/work", "c:/WORK/sub/file.txt"));
    assert!(is_within_dir("C:\\work\\", "C:/work/sub"));
    assert!(!is_within_dir("C:/work", "C:/workshop/file.txt"));
    assert!(is_within_dir("C:/work", "\\\\?\\C:\\work\\sub\\file.txt"));
    assert!(is_within_dir("/", "/etc/hosts"));
  }
}
