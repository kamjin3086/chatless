use serde::{Deserialize, Serialize};
use tauri::{plugin, Manager, State, Wry};

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

pub(super) struct AndroidPhoto(plugin::PluginHandle<Wry>);

pub(super) fn init() -> plugin::TauriPlugin<Wry> {
  plugin::Builder::new("android_photo")
    .setup(|app, api| {
      let handle = api.register_android_plugin("com.kamjin.chatless", "AndroidPhotoPlugin")?;
      app.manage(AndroidPhoto(handle));
      Ok(())
    })
    .build()
}

#[tauri::command]
pub(super) async fn acquire_android_photo(
  photo: State<'_, AndroidPhoto>,
  source: PhotoSource,
) -> Result<PhotoReceipt, String> {
  photo
    .0
    .run_mobile_plugin_async("acquire", PhotoRequest { source })
    .await
    .map_err(|error| error.to_string())
}
