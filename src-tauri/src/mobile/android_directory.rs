use serde::{Deserialize, Serialize};
use tauri::{plugin, Manager, State, Wry};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryRequest {
  conversation_id: String,
}

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

pub(super) struct AndroidDirectory(plugin::PluginHandle<Wry>);

pub(super) fn init() -> plugin::TauriPlugin<Wry> {
  plugin::Builder::new("android_directory")
    .setup(|app, api| {
      let handle = api.register_android_plugin("com.kamjin.chatless", "AndroidDirectoryPlugin")?;
      app.manage(AndroidDirectory(handle));
      Ok(())
    })
    .build()
}

impl AndroidDirectory {
  async fn run(&self, command: &'static str, conversation_id: String) -> DirectoryReceipt {
    if conversation_id.is_empty() || conversation_id.len() > 128 {
      return DirectoryReceipt::Unavailable;
    }
    self
      .0
      .run_mobile_plugin_async(command, DirectoryRequest { conversation_id })
      .await
      .unwrap_or(DirectoryReceipt::Unavailable)
  }
}

#[tauri::command]
pub(super) async fn pick_android_directory(
  directory: State<'_, AndroidDirectory>,
  conversation_id: String,
) -> Result<DirectoryReceipt, String> {
  Ok(directory.run("pick", conversation_id).await)
}

#[tauri::command]
pub(super) async fn android_directory_selection(
  directory: State<'_, AndroidDirectory>,
  conversation_id: String,
) -> Result<DirectoryReceipt, String> {
  Ok(directory.run("selection", conversation_id).await)
}

#[tauri::command]
pub(super) async fn forget_android_directory(
  directory: State<'_, AndroidDirectory>,
  conversation_id: String,
) -> Result<DirectoryReceipt, String> {
  Ok(directory.run("forget", conversation_id).await)
}

#[tauri::command]
pub(super) async fn inventory_android_directory(
  directory: State<'_, AndroidDirectory>,
  conversation_id: String,
) -> Result<DirectoryReceipt, String> {
  Ok(directory.run("inventory", conversation_id).await)
}
