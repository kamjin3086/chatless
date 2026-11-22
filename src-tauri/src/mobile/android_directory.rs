use crate::android_plugin::{self, ConversationRequest};
use serde::{Deserialize, Serialize};
use tauri::{
  plugin::{PluginHandle, TauriPlugin},
  State, Wry,
};

#[derive(Deserialize, Serialize)]
pub(super) struct DirectoryItem {
  handle: String,
  name: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DirectoryEntry {
  handle: String,
  parent_handle: String,
  name: String,
  kind: DirectoryKind,
  mime_type: Option<String>,
  size_bytes: Option<u64>,
  modified_at: Option<u64>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum DirectoryKind {
  Directory,
  File,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DirectoryOmission {
  reason: String,
  parent_handle: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  handle: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  name: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(super) enum DirectoryReceipt {
  Ready {
    folder: DirectoryItem,
    #[serde(skip_serializing_if = "Option::is_none")]
    entries: Option<Vec<DirectoryEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    omissions: Option<Vec<DirectoryOmission>>,
  },
  None,
  Revoked,
  Unavailable,
  Cancelled,
}

pub(super) struct AndroidDirectory(PluginHandle<Wry>);

pub(super) fn init() -> TauriPlugin<Wry> {
  android_plugin::init(
    "android_directory",
    "AndroidDirectoryPlugin",
    AndroidDirectory,
  )
}

impl AndroidDirectory {
  async fn run(&self, command: &str, conversation_id: &str) -> Result<DirectoryReceipt, String> {
    android_plugin::call(
      &self.0,
      "android_directory",
      command,
      ConversationRequest::new(conversation_id)?,
    )
    .await
  }
}

#[tauri::command]
pub(super) async fn pick_android_directory(
  directory: State<'_, AndroidDirectory>,
  conversation_id: String,
) -> Result<DirectoryReceipt, String> {
  directory.run("pick", &conversation_id).await
}

#[tauri::command]
pub(super) async fn android_directory_selection(
  directory: State<'_, AndroidDirectory>,
  conversation_id: String,
) -> Result<DirectoryReceipt, String> {
  directory.run("selection", &conversation_id).await
}

#[tauri::command]
pub(super) async fn forget_android_directory(
  directory: State<'_, AndroidDirectory>,
  conversation_id: String,
) -> Result<DirectoryReceipt, String> {
  directory.run("forget", &conversation_id).await
}

#[tauri::command]
pub(super) async fn inventory_android_directory(
  directory: State<'_, AndroidDirectory>,
  conversation_id: String,
) -> Result<DirectoryReceipt, String> {
  directory.run("inventory", &conversation_id).await
}
