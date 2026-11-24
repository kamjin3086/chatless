//! Plumbing shared by the Android plugin commands: one request body, one
//! registration, one error path. A receipt is only ever a status the plugin
//! itself returned; a plugin failure is logged and returned as an error instead
//! of being dressed up as a receipt the TypeScript side reads as an answer.

use serde::Serialize;

#[cfg(target_os = "android")]
use serde::de::DeserializeOwned;
#[cfg(target_os = "android")]
use tauri::{
  plugin::{self, PluginHandle, TauriPlugin},
  Manager, Wry,
};

/// The body of every conversation-scoped Android command.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConversationRequest {
  conversation_id: String,
}

impl ConversationRequest {
  /// A blank or oversized id cannot address a plugin's per-conversation state.
  pub(crate) fn new(conversation_id: &str) -> Result<Self, String> {
    if conversation_id.is_empty() || conversation_id.len() > 128 {
      return Err("A conversation id of 1 to 128 bytes is required.".into());
    }
    Ok(Self {
      conversation_id: conversation_id.to_owned(),
    })
  }
}

/// Registers the Kotlin `class_name` plugin and keeps its handle as managed state.
#[cfg(target_os = "android")]
pub(crate) fn init<T: Send + Sync + 'static>(
  name: &'static str,
  class_name: &'static str,
  keep: fn(PluginHandle<Wry>) -> T,
) -> TauriPlugin<Wry> {
  plugin::Builder::new(name)
    .setup(move |app, api| {
      let handle = api.register_android_plugin("com.kamjin.chatless", class_name)?;
      app.manage(keep(handle));
      Ok(())
    })
    .build()
}

/// Runs one plugin command, turning a plugin failure into a logged error.
#[cfg(target_os = "android")]
pub(crate) async fn call<R: DeserializeOwned>(
  handle: &PluginHandle<Wry>,
  name: &str,
  command: &str,
  payload: impl Serialize,
) -> Result<R, String> {
  handle
    .run_mobile_plugin_async(command, payload)
    .await
    .map_err(|error| failure(name, command, &error))
}

fn failure(name: &str, command: &str, error: &impl std::fmt::Display) -> String {
  log::warn!("Android plugin '{name}' failed on '{command}': {error}");
  format!("The Android '{name}' plugin failed on '{command}': {error}")
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn rejects_a_conversation_id_that_cannot_scope_plugin_state() {
    assert!(ConversationRequest::new("").is_err());
    assert!(ConversationRequest::new(&"a".repeat(129)).is_err());
  }

  #[test]
  fn sends_the_conversation_id_the_plugin_reads() {
    let request = ConversationRequest::new(&"a".repeat(128)).expect("128 bytes is a valid id");
    assert_eq!(
      serde_json::to_value(request).unwrap(),
      serde_json::json!({ "conversationId": "a".repeat(128) })
    );
  }

  #[test]
  fn names_the_plugin_and_the_command_in_a_failure() {
    let message = failure("android_directory", "inventory", &"plugin not found");
    assert!(message.contains("android_directory"));
    assert!(message.contains("inventory"));
    assert!(message.contains("plugin not found"));
  }
}
