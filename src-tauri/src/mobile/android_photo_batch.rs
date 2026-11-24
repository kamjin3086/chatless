use crate::android_plugin::{self, ConversationRequest};
use serde::{Deserialize, Serialize};
use tauri::{
  plugin::{PluginHandle, TauriPlugin},
  State, Wry,
};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PhotoBatchItem {
  handle: String,
  name: String,
  mime_type: Option<String>,
  size_bytes: Option<u64>,
  content_digest: Option<String>,
}

#[derive(Deserialize, Serialize)]
pub(super) struct PhotoBatchOmission {
  reason: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  name: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(super) enum PhotoBatchReceipt {
  Ready {
    count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    items: Option<Vec<PhotoBatchItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    omissions: Option<Vec<PhotoBatchOmission>>,
  },
  None,
  Cancelled,
  Unavailable,
  Busy,
}

pub(super) struct AndroidPhotoBatch(PluginHandle<Wry>);

pub(super) fn init() -> TauriPlugin<Wry> {
  android_plugin::init(
    "android_photo_batch",
    "AndroidPhotoBatchPlugin",
    AndroidPhotoBatch,
  )
}

impl AndroidPhotoBatch {
  async fn run(&self, command: &str, conversation_id: &str) -> Result<PhotoBatchReceipt, String> {
    android_plugin::call(
      &self.0,
      "android_photo_batch",
      command,
      ConversationRequest::new(conversation_id)?,
    )
    .await
  }
}

#[tauri::command]
pub(super) async fn pick_android_photo_batch(
  photos: State<'_, AndroidPhotoBatch>,
  conversation_id: String,
) -> Result<PhotoBatchReceipt, String> {
  photos.run("pick", &conversation_id).await
}

#[tauri::command]
pub(super) async fn android_photo_batch_selection(
  photos: State<'_, AndroidPhotoBatch>,
  conversation_id: String,
) -> Result<PhotoBatchReceipt, String> {
  photos.run("selection", &conversation_id).await
}

#[tauri::command]
pub(super) async fn forget_android_photo_batch(
  photos: State<'_, AndroidPhotoBatch>,
  conversation_id: String,
) -> Result<PhotoBatchReceipt, String> {
  photos.run("forget", &conversation_id).await
}

#[tauri::command]
pub(super) async fn inventory_android_photo_batch(
  photos: State<'_, AndroidPhotoBatch>,
  conversation_id: String,
) -> Result<PhotoBatchReceipt, String> {
  photos.run("inventory", &conversation_id).await
}
