use crate::android_document_text::{extract_document, DocumentPickResult};
use serde::Deserialize;
use std::{fs::File, os::fd::FromRawFd};
use tauri::{plugin, Manager, State, Wry};
use tokio::sync::Mutex;

#[derive(Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum PickerReceipt {
  Selected { name: String, mime: String, fd: i32 },
  Cancelled,
  Inaccessible,
}

pub(super) struct AndroidDocument {
  plugin: plugin::PluginHandle<Wry>,
  picker: Mutex<()>,
}

pub(super) fn init() -> plugin::TauriPlugin<Wry> {
  plugin::Builder::new("android_document")
    .setup(|app, api| {
      let plugin = api.register_android_plugin("com.kamjin.chatless", "AndroidDocumentPlugin")?;
      app.manage(AndroidDocument {
        plugin,
        picker: Mutex::new(()),
      });
      Ok(())
    })
    .build()
}

#[tauri::command]
pub(super) async fn pick_android_document(
  document: State<'_, AndroidDocument>,
) -> Result<DocumentPickResult, String> {
  let _picker = document
    .picker
    .try_lock()
    .map_err(|_| "A document picker is already in use.")?;
  let receipt = document
    .plugin
    .run_mobile_plugin_async::<PickerReceipt>("pick", ())
    .await;
  match receipt {
    Ok(PickerReceipt::Selected { name, mime, fd }) => {
      // The private Kotlin callback transferred a fresh descriptor using detachFd.
      let file = unsafe { File::from_raw_fd(fd) };
      Ok(
        tauri::async_runtime::spawn_blocking(move || extract_document(file, name, &mime))
          .await
          .unwrap_or(DocumentPickResult::Inaccessible),
      )
    }
    Ok(PickerReceipt::Cancelled) => Ok(DocumentPickResult::Cancelled),
    Ok(PickerReceipt::Inaccessible) | Err(_) => Ok(DocumentPickResult::Inaccessible),
  }
}
