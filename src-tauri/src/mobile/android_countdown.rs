use crate::android_plugin;
use serde::{Deserialize, Serialize};
use tauri::{
  plugin::{PluginHandle, TauriPlugin},
  State, Wry,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CountdownRequest {
  duration_seconds: u32,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(super) enum CountdownReceipt {
  HandedOff,
  Unavailable,
}

pub(super) struct AndroidCountdown(PluginHandle<Wry>);

pub(super) fn init() -> TauriPlugin<Wry> {
  android_plugin::init(
    "android_countdown",
    "AndroidCountdownPlugin",
    AndroidCountdown,
  )
}

#[tauri::command]
pub(super) async fn start_android_countdown(
  countdown: State<'_, AndroidCountdown>,
  duration_seconds: u32,
) -> Result<CountdownReceipt, String> {
  if !(1..=86_400).contains(&duration_seconds) {
    return Err("Countdown duration must be a whole number of seconds from 1 to 86400.".into());
  }

  android_plugin::call(
    &countdown.0,
    "android_countdown",
    "start",
    CountdownRequest { duration_seconds },
  )
  .await
}
