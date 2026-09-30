//! 会话→工作目录映射的持久化。
//!
//! 前端不再通过扫描目录名回找会话目录（那需要短 ID 前缀，两个会话可能共用同一个
//! 目录），这里保存完整会话 ID 到绝对路径的映射，并且只由 Rust 写入。

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceEntry {
  /// 绝对路径，统一使用 `/` 分隔符。
  pub root: String,
  pub created_at: i64,
}

pub type WorkspaceIndex = BTreeMap<String, WorkspaceEntry>;

pub fn index_dir(data_dir: &Path) -> PathBuf {
  data_dir.join("workspaces")
}

pub fn index_path(data_dir: &Path) -> PathBuf {
  index_dir(data_dir).join("index.json")
}

/// Loads the mapping. A missing or unreadable file means "no workspaces yet";
/// the directories themselves are never touched by a failed read.
pub async fn load(data_dir: &Path) -> WorkspaceIndex {
  match tokio::fs::read_to_string(index_path(data_dir)).await {
    Ok(text) => serde_json::from_str::<WorkspaceIndex>(&text).unwrap_or_default(),
    Err(_) => WorkspaceIndex::new(),
  }
}

pub async fn save(data_dir: &Path, index: &WorkspaceIndex) -> Result<(), String> {
  let dir = index_dir(data_dir);
  tokio::fs::create_dir_all(&dir)
    .await
    .map_err(|error| format!("WORKSPACE_INDEX_WRITE_FAILED: 创建索引目录失败: {error}"))?;
  let text = serde_json::to_string_pretty(index)
    .map_err(|error| format!("WORKSPACE_INDEX_WRITE_FAILED: 序列化索引失败: {error}"))?;
  let target = index_path(data_dir);
  let temp = dir.join("index.json.tmp");
  tokio::fs::write(&temp, text)
    .await
    .map_err(|error| format!("WORKSPACE_INDEX_WRITE_FAILED: 写入索引失败: {error}"))?;
  tokio::fs::rename(&temp, &target)
    .await
    .map_err(|error| format!("WORKSPACE_INDEX_WRITE_FAILED: 替换索引失败: {error}"))?;
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("chatless-ws-index-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[tokio::test]
  async fn round_trips_the_mapping() {
    let data = temp_dir("round-trip");
    let mut index = WorkspaceIndex::new();
    index.insert(
      "conversation-1".to_string(),
      WorkspaceEntry { root: "C:/Users/x/Documents/Chatless/a-123abc".to_string(), created_at: 7 },
    );
    save(&data, &index).await.unwrap();

    let loaded = load(&data).await;
    assert_eq!(loaded.get("conversation-1").map(|e| e.root.as_str()), Some("C:/Users/x/Documents/Chatless/a-123abc"));
    let _ = std::fs::remove_dir_all(&data);
  }

  #[tokio::test]
  async fn a_missing_index_reads_as_empty() {
    let data = temp_dir("missing");
    assert!(load(&data).await.is_empty());
    let _ = std::fs::remove_dir_all(&data);
  }
}
