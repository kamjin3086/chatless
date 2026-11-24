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
  /// Name path from the scanned folder, so a nested item can be named and then asked for.
  #[serde(default)]
  path: Option<String>,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InventoryRequest {
  conversation_id: String,
  /// Omitted entirely when there is no name: a JSON `null` arrives in Kotlin as the string
  /// "null", which reads like a folder called that.
  #[serde(skip_serializing_if = "Option::is_none")]
  root: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  under: Option<String>,
  /// Filters ride down to the walk: a folder of thousands filtered after a row cap answers
  /// "none" for matches that were sitting past the cap.
  #[serde(skip_serializing_if = "Option::is_none")]
  name_contains: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  mime_type: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  min_bytes: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  max_bytes: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  modified_from: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  modified_before: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  group_by: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  limit: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  offset: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportRequest {
  conversation_id: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  root: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  under: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  name_contains: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  mime_type: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  min_bytes: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  max_bytes: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  modified_from: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  modified_before: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  title: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  format: Option<String>,
  /// A comma separated list; the plugin picks the columns and the order they print in.
  #[serde(skip_serializing_if = "Option::is_none")]
  columns: Option<String>,
}

/// One authorized folder's inventory or summary. Shapes that only the summary fills stay loose:
/// the plugin owns them, and a model reads them straight through.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DirectorySection {
  folder: DirectoryItem,
  #[serde(default)]
  entries: Vec<DirectoryEntry>,
  #[serde(default)]
  omissions: Vec<DirectoryOmission>,
  #[serde(default)]
  groups: Option<serde_json::Value>,
  #[serde(default)]
  totals: Option<serde_json::Value>,
  #[serde(default)]
  largest: Option<serde_json::Value>,
  #[serde(default)]
  newest: Option<serde_json::Value>,
  #[serde(default)]
  oldest: Option<serde_json::Value>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    sections: Option<Vec<DirectorySection>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    groups: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    totals: Option<serde_json::Value>,
  },
  RootNotFound {
    #[serde(skip_serializing_if = "Option::is_none")]
    roots: Option<Vec<String>>,
  },
  /// `under` named no subfolder: `choices` says what each authorized folder holds at that level.
  SubfolderNotFound {
    #[serde(skip_serializing_if = "Option::is_none")]
    under: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    choices: Option<serde_json::Value>,
  },
  /// A listing written out to the shared Downloads folder instead of recited into the chat.
  Saved {
    name: String,
    uri: String,
    count: i64,
    bytes: i64,
    format: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    columns: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stopped: Option<String>,
  },
  /// Nothing matched, so no file was written: an empty清单 is a dead end for a user.
  Empty,
  None,
  Revoked,
  Unavailable,
  Cancelled,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EmptyRequest {}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UriRequest<'a> {
  uri: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RootAgentRequest<'a> {
  uri: &'a str,
  agent_enabled: bool,
}

/// One folder the app holds a read grant for.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AuthorizedRoot {
  uri: String,
  name: String,
  agent_enabled: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AuthorizedRoots {
  roots: Vec<AuthorizedRoot>,
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
pub(super) async fn android_directory_roots(
  directory: State<'_, AndroidDirectory>,
) -> Result<AuthorizedRoots, String> {
  android_plugin::call(
    &directory.0,
    "android_directory",
    "roots",
    EmptyRequest {},
  )
  .await
}

#[tauri::command]
pub(super) async fn set_android_directory_root(
  directory: State<'_, AndroidDirectory>,
  uri: String,
  agent_enabled: bool,
) -> Result<DirectoryReceipt, String> {
  android_plugin::call(
    &directory.0,
    "android_directory",
    "setRootAgent",
    RootAgentRequest {
      uri: &uri,
      agent_enabled,
    },
  )
  .await
}

#[tauri::command]
pub(super) async fn revoke_android_directory_root(
  directory: State<'_, AndroidDirectory>,
  uri: String,
) -> Result<DirectoryReceipt, String> {
  android_plugin::call(
    &directory.0,
    "android_directory",
    "revokeRoot",
    UriRequest { uri: &uri },
  )
  .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(super) async fn inventory_android_directory(
  directory: State<'_, AndroidDirectory>,
  conversation_id: String,
  root: Option<String>,
  under: Option<String>,
  name_contains: Option<String>,
  mime_type: Option<String>,
  min_bytes: Option<i64>,
  max_bytes: Option<i64>,
  modified_from: Option<i64>,
  modified_before: Option<i64>,
  group_by: Option<String>,
  limit: Option<i64>,
  offset: Option<i64>,
) -> Result<DirectoryReceipt, String> {
  let request = inventory_request(
    conversation_id,
    &root,
    &under,
    &name_contains,
    &mime_type,
    &min_bytes,
    &max_bytes,
    &modified_from,
    &modified_before,
    &group_by,
    &limit,
    &offset,
  );
  android_plugin::call(&directory.0, "android_directory", "inventory", request).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(super) async fn summarize_android_directory(
  directory: State<'_, AndroidDirectory>,
  conversation_id: String,
  root: Option<String>,
  under: Option<String>,
  name_contains: Option<String>,
  mime_type: Option<String>,
  min_bytes: Option<i64>,
  max_bytes: Option<i64>,
  modified_from: Option<i64>,
  modified_before: Option<i64>,
  group_by: Option<String>,
) -> Result<DirectoryReceipt, String> {
  let request = inventory_request(
    conversation_id,
    &root,
    &under,
    &name_contains,
    &mime_type,
    &min_bytes,
    &max_bytes,
    &modified_from,
    &modified_before,
    &group_by,
    &None,
    &None,
  );
  android_plugin::call(&directory.0, "android_directory", "summarize", request).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(super) async fn export_android_directory(
  directory: State<'_, AndroidDirectory>,
  conversation_id: String,
  root: Option<String>,
  under: Option<String>,
  name_contains: Option<String>,
  mime_type: Option<String>,
  min_bytes: Option<i64>,
  max_bytes: Option<i64>,
  modified_from: Option<i64>,
  modified_before: Option<i64>,
  title: Option<String>,
  format: Option<String>,
  columns: Option<String>,
) -> Result<DirectoryReceipt, String> {
  let request = ExportRequest {
    conversation_id,
    root: blank(&root),
    under: blank(&under),
    name_contains: blank(&name_contains),
    mime_type: blank(&mime_type),
    min_bytes: bytes(&min_bytes),
    max_bytes: bytes(&max_bytes),
    modified_from: stamp(&modified_from),
    modified_before: stamp(&modified_before),
    title: blank(&title),
    format: blank(&format),
    columns: blank(&columns),
  };
  android_plugin::call(&directory.0, "android_directory", "export", request).await
}

/// Filters arrive from a chat, so empty strings mean "no filter" rather than "match this".
fn blank(value: &Option<String>) -> Option<String> {
  value
    .as_deref()
    .map(str::trim)
    .filter(|text| !text.is_empty() && *text != "null")
    .map(str::to_string)
}

fn bytes(value: &Option<i64>) -> Option<i64> {
  value.filter(|value| *value >= 0)
}

fn stamp(value: &Option<i64>) -> Option<i64> {
  value.filter(|value| *value > 0)
}

pub(super) fn inventory_request(
  conversation_id: String,
  root: &Option<String>,
  under: &Option<String>,
  name_contains: &Option<String>,
  mime_type: &Option<String>,
  min_bytes: &Option<i64>,
  max_bytes: &Option<i64>,
  modified_from: &Option<i64>,
  modified_before: &Option<i64>,
  group_by: &Option<String>,
  limit: &Option<i64>,
  offset: &Option<i64>,
) -> InventoryRequest {
  InventoryRequest {
    conversation_id,
    root: blank(root),
    under: blank(under),
    name_contains: blank(name_contains),
    mime_type: blank(mime_type),
    min_bytes: bytes(min_bytes),
    max_bytes: bytes(max_bytes),
    modified_from: stamp(modified_from),
    modified_before: stamp(modified_before),
    group_by: blank(group_by),
    limit: (*limit).filter(|value| (1..=1000).contains(value)),
    offset: (*offset).filter(|value| *value > 0),
  }
}
