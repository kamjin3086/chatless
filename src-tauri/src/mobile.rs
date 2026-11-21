//! Experimental mobile composition root. Desktop process, workspace and embedding
//! commands are deliberately not registered until their mobile boundaries exist.
use crate::{agent_runtime, http_client, http_request, mcp, sse};

pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_os::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_store::Builder::new().build())
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Info).build())
    .manage(sse::AppState::new())
    .manage(mcp::state::McpState::new())
    .invoke_handler(tauri::generate_handler![
      crate::greet,
      crate::set_log_level,
      sse::start_sse,
      sse::stop_sse,
      http_client::get_http_client_info,
      http_request::send_http_request,
      agent_runtime::agent_create_run,
      agent_runtime::agent_append_event,
      agent_runtime::agent_commit_model_step,
      agent_runtime::agent_set_run_status,
      agent_runtime::agent_save_checkpoint,
      agent_runtime::agent_request_approval,
      agent_runtime::agent_decide_approval,
      mcp::commands::mcp_connect,
      mcp::commands::mcp_disconnect,
      mcp::commands::mcp_list_tools,
      mcp::commands::mcp_call_tool,
      mcp::commands::mcp_list_resources,
      mcp::commands::mcp_read_resource,
      mcp::commands::mcp_list_prompts,
      mcp::commands::mcp_get_prompt,
    ])
    .run(tauri::generate_context!())
    .expect("error while running experimental mobile application");
}
