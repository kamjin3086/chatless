use serde::{Deserialize, Serialize};
use tauri::{plugin, Manager, State, Wry};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchRequest {
  conversation_id: String,
}

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

pub(super) struct AndroidPhotoBatch(plugin::PluginHandle<Wry>);

pub(super) fn init() -> plugin::TauriPlugin<Wry> {
  plugin::Builder::new("android_photo_batch")
    .setup(|app, api| {
      let handle = api.register_android_plugin("com.kamjin.chatless", "AndroidPhotoBatchPlugin")?;
      app.manage(AndroidPhotoBatch(handle));
      Ok(())
    })
    .build()
}

impl AndroidPhotoBatch {
  async fn run(&self, command: &'static str, conversation_id: String) -> PhotoBatchReceipt {
    if conversation_id.is_empty() || conversation_id.len() > 128 {
      return PhotoBatchReceipt::Unavailable;
    }
    self
      .0
      .run_mobile_plugin_async(command, BatchRequest { conversation_id })
      .await
      .unwrap_or(PhotoBatchReceipt::Unavailable)
  }
}

#[tauri::command]
pub(super) async fn pick_android_photo_batch(
  photos: State<'_, AndroidPhotoBatch>,
  conversation_id: String,
) -> Result<PhotoBatchReceipt, String> {
  Ok(photos.run("pick", conversation_id).await)
}

#[tauri::command]
pub(super) async fn android_photo_batch_selection(
  photos: State<'_, AndroidPhotoBatch>,
  conversation_id: String,
) -> Result<PhotoBatchReceipt, String> {
  Ok(photos.run("selection", conversation_id).await)
}

#[tauri::command]
pub(super) async fn forget_android_photo_batch(
  photos: State<'_, AndroidPhotoBatch>,
  conversation_id: String,
) -> Result<PhotoBatchReceipt, String> {
  Ok(photos.run("forget", conversation_id).await)
}

#[tauri::command]
pub(super) async fn inventory_android_photo_batch(
  photos: State<'_, AndroidPhotoBatch>,
  conversation_id: String,
) -> Result<PhotoBatchReceipt, String> {
  Ok(photos.run("inventory", conversation_id).await)
}
