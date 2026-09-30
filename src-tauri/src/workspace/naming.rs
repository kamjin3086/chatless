//! 会话目录命名。
//!
//! 目录名只用于人眼识别：身份来自 `workspaces/index.json`，因此唯一性必须来自
//! 会话 ID 的稳定摘要，而不是容易撞车的短前缀（两个 UUID 的前六位可以完全相同）。

use sha2::{Digest, Sha256};

const MAX_SLUG_CHARS: usize = 40;

/// 把会话标题变成安全的目录名片段。
pub fn sanitize_slug(title: &str) -> String {
  let cleaned: String = title
    .chars()
    .map(|c| match c {
      '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => ' ',
      c if (c as u32) < 0x20 => ' ',
      c => c,
    })
    .collect();
  let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
  let limited: String = collapsed
    .trim_matches(|c: char| c == '.' || c == ' ')
    .chars()
    .take(MAX_SLUG_CHARS)
    .collect();
  let limited = limited.trim();
  if limited.is_empty() {
    "会话".to_string()
  } else {
    limited.to_string()
  }
}

/// 会话 ID 的稳定短摘要，用来区分同标题的会话。
pub fn stable_suffix(conversation_id: &str) -> String {
  let mut hasher = Sha256::new();
  hasher.update(conversation_id.trim().as_bytes());
  let digest = hex::encode(hasher.finalize());
  digest[..6].to_string()
}

/// 会话目录名：`<标题>-<摘要>`。
pub fn folder_name(title: &str, conversation_id: &str) -> String {
  format!("{}-{}", sanitize_slug(title), stable_suffix(conversation_id))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn sanitizes_windows_hostile_characters() {
    assert_eq!(sanitize_slug("a/b:c*d?e"), "a b c d e");
    assert_eq!(sanitize_slug("   "), "会话");
    assert_eq!(sanitize_slug("..."), "会话");
  }

  #[test]
  fn caps_the_visible_slug() {
    let long = "字".repeat(80);
    assert_eq!(sanitize_slug(&long).chars().count(), MAX_SLUG_CHARS);
  }

  #[test]
  fn ids_sharing_a_six_character_prefix_get_different_folders() {
    let first = folder_name("New chat", "abcdef00-1111-2222-3333-444455556666");
    let second = folder_name("New chat", "abcdef99-7777-8888-9999-aaaabbbbcccc");
    assert_ne!(first, second);
    assert!(first.starts_with("New chat-"));
  }

  #[test]
  fn the_same_id_always_maps_to_the_same_folder() {
    assert_eq!(
      folder_name("标题", "3f9a21aa-bbbb"),
      folder_name("标题", "3f9a21aa-bbbb")
    );
  }
}
