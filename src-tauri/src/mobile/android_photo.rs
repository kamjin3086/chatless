use crate::android_plugin;
use serde::{Deserialize, Serialize};
use tauri::{
  plugin::{PluginHandle, TauriPlugin},
  State, Wry,
};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum PhotoSource {
  Capture,
  Pick,
}

#[derive(Serialize)]
struct PhotoRequest {
  source: PhotoSource,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(super) enum PhotoReceipt {
  Selected {
    #[serde(rename = "jpegBase64")]
    jpeg_base64: String,
  },
  Cancelled,
  Unavailable,
  Unreadable,
  TooLarge,
  Busy,
}

pub(super) struct AndroidPhoto(PluginHandle<Wry>);

pub(super) fn init() -> TauriPlugin<Wry> {
  android_plugin::init("android_photo", "AndroidPhotoPlugin", AndroidPhoto)
}

#[tauri::command]
pub(super) async fn acquire_android_photo(
  photo: State<'_, AndroidPhoto>,
  source: PhotoSource,
) -> Result<PhotoReceipt, String> {
  android_plugin::call(
    &photo.0,
    "android_photo",
    "acquire",
    PhotoRequest { source },
  )
  .await
}
