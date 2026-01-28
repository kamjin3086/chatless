use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;
use tauri::Manager;
use tokio::sync::RwLock;

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

#[derive(Default)]
pub struct FilesystemAllowlistState {
  loaded: AtomicBool,
  inner: RwLock<AllowlistSnapshot>,
}

#[derive(Debug, Clone, Copy)]
pub enum FsOp {
  Read,
  Write,
  Create,
  Delete,
}

fn normalize_slashes(p: &str) -> String {
  p.trim().replace('\\', "/")
}

fn normalize_abs_path(p: &str) -> Result<String, String> {
  let s = normalize_slashes(p);
  if s.is_empty() {
    return Err("path is required".to_string());
  }
  if s.contains("://") {
    return Err("protocol path is not allowed".to_string());
  }
  // require absolute
  let is_abs = s.starts_with('/') || (s.len() >= 3 && s.as_bytes()[1] == b':' && (s.as_bytes()[2] == b'/' || s.as_bytes()[2] == b'\\'));
  if !is_abs {
    return Err("absolute path is required".to_string());
  }
  // trim trailing slashes, keep / and C:/
  if s == "/" {
    return Ok("/".to_string());
  }
  if s.len() == 3 && s.as_bytes()[1] == b':' && s.ends_with('/') {
    return Ok(s);
  }
  Ok(s.trim_end_matches('/').to_string())
}

fn is_windows_drive_path(p: &str) -> bool {
  let s = p.as_bytes();
  s.len() >= 3 && s[1] == b':' && s[2] == b'/'
}

fn comparable(p: &str) -> String {
  let s = normalize_slashes(p);
  if is_windows_drive_path(&s) {
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
  if p.starts_with(&(d.clone() + "/")) {
    return true;
  }
  false
}

fn best_match<'a>(dirs: &'a [AllowlistDirectory], abs_path: &str) -> Option<&'a AllowlistDirectory> {
  let mut best: Option<&AllowlistDirectory> = None;
  let mut best_len: usize = 0;
  for d in dirs {
    if is_within_dir(&d.path, abs_path) {
      let l = d.path.len();
      if l >= best_len {
        best = Some(d);
        best_len = l;
      }
    }
  }
  best
}

fn op_allowed(perm: &FsPermissions, op: FsOp) -> bool {
  match op {
    FsOp::Read => perm.read,
    FsOp::Write => perm.write,
    FsOp::Create => perm.create,
    FsOp::Delete => perm.delete,
  }
}

async fn storage_path(app: &AppHandle) -> Result<PathBuf, String> {
  let base = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("resolve app_data_dir failed: {}", e))?;
  Ok(base.join("filesystem-allowlist.json"))
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
  pub async fn ensure_loaded(&self, app: &AppHandle) -> Result<(), String> {
    if self.loaded.load(Ordering::SeqCst) {
      return Ok(());
    }
    // best-effort load; if file missing, treat as empty allowlist
    let p = storage_path(app).await?;
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

  pub async fn set_allowlist(&self, app: &AppHandle, mut snapshot: AllowlistSnapshot) -> Result<(), String> {
    // normalize paths
    for d in snapshot.directories.iter_mut() {
      d.path = normalize_abs_path(&d.path)?;
    }
    snapshot.version = snapshot.version.max(1);

    {
      let mut w = self.inner.write().await;
      *w = snapshot.clone();
    }

    let p = storage_path(app).await?;
    ensure_parent_dir(&p).await?;
    tokio::fs::write(&p, serde_json::to_string_pretty(&snapshot).unwrap_or_else(|_| "{}".to_string()))
      .await
      .map_err(|e| format!("persist allowlist failed: {}", e))?;

    self.loaded.store(true, Ordering::SeqCst);
    Ok(())
  }

  pub async fn assert_allowed(&self, app: &AppHandle, input_path: &str, op: FsOp) -> Result<String, String> {
    self.ensure_loaded(app).await?;
    let abs = normalize_abs_path(input_path)?;
    let snap = self.inner.read().await;
    let m = best_match(&snap.directories, &abs).ok_or_else(|| format!("forbidden path: {}", abs))?;
    if !op_allowed(&m.permissions, op) {
      return Err(format!("forbidden op for path: {}", abs));
    }
    Ok(abs)
  }
}

