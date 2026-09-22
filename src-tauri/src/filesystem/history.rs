//! 文件历史：覆盖/编辑之前保留旧内容，允许一键恢复。
//!
//! 历史保存在应用数据目录（`file-history/<路径哈希>/`），不写进用户的项目目录：
//! 用户目录里多出一个隐藏文件夹会污染仓库、影响构建。
//!
//! 保留策略：每个文件最近 [`MAX_VERSIONS_PER_FILE`] 版，全局上限
//! [`MAX_HISTORY_BYTES`]，超限时淘汰最旧的版本。

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// 每个文件保留的版本数。
pub const MAX_VERSIONS_PER_FILE: usize = 20;
/// 历史目录总大小上限（字节）。
pub const MAX_HISTORY_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileVersion {
  pub id: String,
  pub created_at: i64,
  pub bytes: u64,
  pub sha256: String,
  /// 产生这次覆盖的工具：write / edit / restore
  pub tool: String,
  #[serde(default)]
  pub run_id: Option<String>,
}

fn sha256_hex(bytes: &[u8]) -> String {
  let mut hasher = Sha256::new();
  hasher.update(bytes);
  hex::encode(hasher.finalize())
}

fn now_ms() -> i64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0)
}

/// 规范化路径用于做历史目录的键：大小写与分隔符差异不应产生两份历史。
pub fn history_key(path: &str) -> String {
  let normalized = path.replace('\\', "/").to_lowercase();
  let trimmed = normalized.strip_prefix("//?/").unwrap_or(&normalized).to_string();
  sha256_hex(trimmed.as_bytes())[..32].to_string()
}

pub fn history_root(data_dir: &Path) -> PathBuf {
  data_dir.join("file-history")
}

fn key_dir(data_dir: &Path, path: &str) -> PathBuf {
  history_root(data_dir).join(history_key(path))
}

fn content_path(key_dir: &Path, id: &str) -> PathBuf {
  key_dir.join(format!("{id}.bak"))
}

fn meta_path(key_dir: &Path, id: &str) -> PathBuf {
  key_dir.join(format!("{id}.json"))
}

/// 记录一版旧内容。返回写入的版本信息；写历史失败不影响主流程。
pub async fn record_version(
  data_dir: &Path,
  path: &str,
  content: &[u8],
  tool: &str,
  run_id: Option<&str>,
) -> Option<FileVersion> {
  let dir = key_dir(data_dir, path);
  if let Err(error) = tokio::fs::create_dir_all(&dir).await {
    log::warn!("[file-history] 创建历史目录失败: {error}");
    return None;
  }
  let created_at = now_ms();
  let id = format!("{created_at}-{}", std::process::id() % 100000);
  let version = FileVersion {
    id: id.clone(),
    created_at,
    bytes: content.len() as u64,
    sha256: sha256_hex(content),
    tool: tool.to_string(),
    run_id: run_id.map(|value| value.to_string()),
  };

  if let Err(error) = tokio::fs::write(content_path(&dir, &id), content).await {
    log::warn!("[file-history] 写入历史内容失败: {error}");
    return None;
  }
  match serde_json::to_string_pretty(&version) {
    Ok(json) => {
      if let Err(error) = tokio::fs::write(meta_path(&dir, &id), json).await {
        log::warn!("[file-history] 写入历史元数据失败: {error}");
        return None;
      }
    }
    Err(error) => {
      log::warn!("[file-history] 序列化历史元数据失败: {error}");
      return None;
    }
  }

  prune(data_dir, &dir).await;
  Some(version)
}

/// 列出某个路径的版本，最新在前。
pub async fn list_versions(data_dir: &Path, path: &str) -> Vec<FileVersion> {
  let dir = key_dir(data_dir, path);
  let mut entries = match tokio::fs::read_dir(&dir).await {
    Ok(entries) => entries,
    Err(_) => return Vec::new(),
  };
  let mut versions: Vec<FileVersion> = Vec::new();
  while let Ok(Some(entry)) = entries.next_entry().await {
    let name = entry.file_name().to_string_lossy().to_string();
    if !name.ends_with(".json") {
      continue;
    }
    let Ok(text) = tokio::fs::read_to_string(entry.path()).await else { continue };
    if let Ok(version) = serde_json::from_str::<FileVersion>(&text) {
      versions.push(version);
    }
  }
  versions.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
  versions
}

/// 读取某一版内容。
pub async fn read_version(data_dir: &Path, path: &str, version_id: &str) -> Result<Vec<u8>, String> {
  if version_id.contains('/') || version_id.contains('\\') || version_id.contains("..") {
    return Err("版本 ID 不合法".to_string());
  }
  let dir = key_dir(data_dir, path);
  let meta = meta_path(&dir, version_id);
  if tokio::fs::metadata(&meta).await.is_err() {
    return Err(format!("找不到该版本: {version_id}"));
  }
  tokio::fs::read(content_path(&dir, version_id))
    .await
    .map_err(|error| format!("读取历史版本失败: {error}"))
}

/// 淘汰超量版本：先是单文件超过上限，再是全局体积。
async fn prune(data_dir: &Path, dir: &Path) {
  let mut entries: Vec<(String, i64, u64)> = Vec::new();
  if let Ok(mut read) = tokio::fs::read_dir(dir).await {
    while let Ok(Some(entry)) = read.next_entry().await {
      let name = entry.file_name().to_string_lossy().to_string();
      if !name.ends_with(".json") {
        continue;
      }
      let Ok(text) = tokio::fs::read_to_string(entry.path()).await else { continue };
      let Ok(version) = serde_json::from_str::<FileVersion>(&text) else { continue };
      entries.push((version.id, version.created_at, version.bytes));
    }
  }
  entries.sort_by(|a, b| b.1.cmp(&a.1));
  for (id, _, _) in entries.iter().skip(MAX_VERSIONS_PER_FILE) {
    remove_version(dir, id).await;
  }

  // 全局体积：按最旧优先淘汰
  let root = history_root(data_dir);
  let mut all: Vec<(PathBuf, String, i64, u64)> = Vec::new();
  if let Ok(mut keys) = tokio::fs::read_dir(&root).await {
    while let Ok(Some(key)) = keys.next_entry().await {
      let Ok(kind) = key.file_type().await else { continue };
      if !kind.is_dir() {
        continue;
      }
      if let Ok(mut versions) = tokio::fs::read_dir(key.path()).await {
        while let Ok(Some(entry)) = versions.next_entry().await {
          let name = entry.file_name().to_string_lossy().to_string();
          if !name.ends_with(".json") {
            continue;
          }
          let Ok(text) = tokio::fs::read_to_string(entry.path()).await else { continue };
          let Ok(version) = serde_json::from_str::<FileVersion>(&text) else { continue };
          all.push((key.path(), version.id, version.created_at, version.bytes));
        }
      }
    }
  }
  let mut total: u64 = all.iter().map(|(_, _, _, bytes)| *bytes).sum();
  if total <= MAX_HISTORY_BYTES {
    return;
  }
  all.sort_by(|a, b| a.2.cmp(&b.2));
  for (dir, id, _, bytes) in all {
    if total <= MAX_HISTORY_BYTES {
      break;
    }
    remove_version(&dir, &id).await;
    total = total.saturating_sub(bytes);
  }
}

async fn remove_version(dir: &Path, id: &str) {
  let _ = tokio::fs::remove_file(content_path(dir, id)).await;
  let _ = tokio::fs::remove_file(meta_path(dir, id)).await;
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("chatless-history-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[tokio::test]
  async fn records_and_reads_a_version() {
    let data = temp_dir("record");
    let version = record_version(&data, "C:/work/notes.txt", b"old content", "write", Some("run-1"))
      .await
      .expect("version recorded");
    assert_eq!(version.bytes, 11);
    assert_eq!(version.tool, "write");

    let versions = list_versions(&data, "C:/work/notes.txt").await;
    assert_eq!(versions.len(), 1);
    let content = read_version(&data, "C:/work/notes.txt", &version.id).await.unwrap();
    assert_eq!(content, b"old content");
    let _ = std::fs::remove_dir_all(&data);
  }

  #[tokio::test]
  async fn history_is_scoped_to_one_path() {
    let data = temp_dir("scoped");
    let version = record_version(&data, "C:/work/a.txt", b"a", "write", None).await.unwrap();
    assert!(list_versions(&data, "C:/work/b.txt").await.is_empty());
    assert!(read_version(&data, "C:/work/b.txt", &version.id).await.is_err());
    let _ = std::fs::remove_dir_all(&data);
  }

  #[tokio::test]
  async fn keeps_only_the_newest_versions_per_file() {
    let data = temp_dir("prune");
    for index in 0..(MAX_VERSIONS_PER_FILE + 5) {
      record_version(&data, "C:/work/a.txt", format!("v{index}").as_bytes(), "edit", None).await;
    }
    let versions = list_versions(&data, "C:/work/a.txt").await;
    assert_eq!(versions.len(), MAX_VERSIONS_PER_FILE);
    // newest first
    assert!(versions[0].created_at >= versions[versions.len() - 1].created_at);
    let _ = std::fs::remove_dir_all(&data);
  }

  #[tokio::test]
  async fn key_ignores_case_and_separator_differences() {
    assert_eq!(history_key("C:\\Work\\A.txt"), history_key("c:/work/a.txt"));
  }
}
