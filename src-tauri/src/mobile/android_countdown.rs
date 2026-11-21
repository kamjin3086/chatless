use serde::{Deserialize, Serialize};
use tauri::{plugin, Manager, State, Wry};

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

pub(super) struct AndroidCountdown(plugin::PluginHandle<Wry>);

pub(super) fn init() -> plugin::TauriPlugin<Wry> {
  plugin::Builder::new("android_countdown")
    .setup(|app, api| {
      let handle = api.register_android_plugin("com.kamjin.chatless", "AndroidCountdownPlugin")?;
      app.manage(AndroidCountdown(handle));
      Ok(())
    })
    .build()
}

#[tauri::command]
pub(super) async fn start_android_countdown(
  countdown: State<'_, AndroidCountdown>,
  duration_seconds: u32,
) -> Result<CountdownReceipt, String> {
  if !(1..=86_400).contains(&duration_seconds) {
    return Err("Countdown duration must be a whole number of seconds from 1 to 86400.".into());
  }

  countdown
    .0
    .run_mobile_plugin_async("start", CountdownRequest { duration_seconds })
    .await
    .map_err(|error| error.to_string())
}
