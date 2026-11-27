// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[cfg(target_os = "macos")]
mod macos_window;

mod window_fit;

use anyhow::Result;
use log::LevelFilter;
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::path::BaseDirectory;
use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

#[path = "env_setup.rs"]
pub mod env_setup;

#[path = "mcp/mod.rs"]
pub mod mcp;

#[path = "web_search/mod.rs"]
pub mod web_search;

#[path = "sandbox/mod.rs"]
pub mod sandbox;

#[path = "filesystem/mod.rs"]
pub mod filesystem;

#[path = "workspace/mod.rs"]
pub mod workspace;

#[tauri::command]
fn exit(app: tauri::AppHandle, code: i32) {
  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  {
    use tauri_plugin_window_state::AppHandleExt;
    let _ = app.save_window_state(persisted_window_state_flags());
  }
  // Not `std::process::exit`, which kills the process from this command's own thread: no
  // `RunEvent::Exit`, no plugin cleanup, and ONNX Runtime left standing next to its own
  // destructors. Ask the loop to end and let it finish on the main thread.
  app.exit(code);
}

/// Keep size/position, never restore the OS title bar (custom title bar owns chrome).
///
/// `VISIBLE` is deliberately not restored: hiding the window to the tray saved
/// `visible: false`, so the next launch came up with no window at all - the dock
/// icon stayed, the process ran, nothing was on screen and there was no window to
/// click. The window is always shown on launch now; hiding it stays a runtime
/// action (tray menu / close-to-tray).
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn persisted_window_state_flags() -> tauri_plugin_window_state::StateFlags {
  use tauri_plugin_window_state::StateFlags;
  StateFlags::SIZE
    | StateFlags::POSITION
    | StateFlags::MAXIMIZED
    | StateFlags::FULLSCREEN
}

#[path = "lib/onnx_logic.rs"]
pub mod onnx_logic;

#[path = "lib/document_parser.rs"]
pub mod document_parser;

#[path = "lib/document_structured.rs"]
pub mod document_structured;

#[path = "lib/sse.rs"]
pub mod sse;

#[path = "lib/agent_runtime.rs"]
pub mod agent_runtime;

#[cfg(test)]
#[path = "lib/retrieval_bench.rs"]
mod retrieval_bench;

#[cfg(test)]
#[path = "lib/dense_bench.rs"]
mod dense_bench;

#[path = "lib/http_client.rs"]
pub mod http_client;

#[path = "lib/http_request.rs"]
pub mod http_request;

#[tauri::command]
fn greet() -> String {
  let now = SystemTime::now();
  let epoch_ms = now
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_millis())
    .unwrap_or(0);
  format!("Hello world from Rust! Current epoch: {}", epoch_ms)
}

/// 检查 npx 是否可用
#[tauri::command]
fn check_npx_availability() -> env_setup::ToolAvailability {
  env_setup::check_npx_availability()
}

/// 获取完整的环境健康状态
#[tauri::command]
fn get_environment_health() -> env_setup::EnvironmentHealth {
  env_setup::get_environment_health()
}

/// 检查 MCP 服务是否可以正常运行
#[tauri::command]
fn can_run_mcp_services() -> bool {
  env_setup::can_run_mcp_services()
}

/// 应用退出时释放 ONNX 等资源
#[tauri::command]
fn cleanup_on_exit(state: tauri::State<onnx_logic::OnnxState>) -> Result<(), String> {
  onnx_logic::clear_onnx_sessions(state)
}

/// The code the process leaves with, taken from `RunEvent::ExitRequested` so a caller that
/// asked for a specific one still gets it.
static EXIT_CODE: AtomicI32 = AtomicI32::new(0);

/// Set when the exit was a restart (the updater's relaunch). Tauri re-executes the process
/// itself in that case, so the fast exit path below must not take it.
static RESTARTING: AtomicBool = AtomicBool::new(false);

pub fn run() {
  let app = tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_os::init())
    .plugin(tauri_plugin_process::init())
    .setup(|app| {
      #[cfg(not(any(target_os = "android", target_os = "ios")))]
      {
        let flags = persisted_window_state_flags();
        let _ = app.handle().plugin(
          tauri_plugin_window_state::Builder::default()
            .with_state_flags(flags)
            .build(),
        );
        if let Some(win) = app.get_webview_window("main") {
          use tauri_plugin_window_state::WindowExt;
          let _ = win.restore_state(flags);
          // The plugin also restores a saved *hidden* state, which leaves a
          // running process with no window at all: dock icon present, nothing on
          // screen, and nothing to click. Desktop builds always come up visible;
          // hiding stays a runtime action (tray / close-to-tray).
          let _ = win.show();
          let _ = win.set_decorations(false);
          // A restored size can be larger than the desktop it lands on (saved on
          // a bigger monitor, or a preset bigger than this work area). Fit it
          // before the first paint: see src/window_fit.rs.
          if let Err(err) = window_fit::fit_to_work_area(&win) {
            log::warn!("fitting the main window to its work area failed: {err}");
          }

          // Borderless windows get no corners from macOS, and the configured
          // window background colour would hide them even if they did. See
          // src/macos_window.rs.
          #[cfg(target_os = "macos")]
          {
            macos_window::apply(&win, win.label());
            // The restored window state may already be maximized.
            macos_window::sync_corner_radius();
          }
        }
      }
      // 尝试在后台线程初始化 ONNX Runtime，避免阻塞启动
      std::thread::spawn({
        let app_handle = app.handle().clone();
        move || {
          let lib_name = if cfg!(target_os = "windows") {
            "onnxruntime.dll"
          } else if cfg!(target_os = "macos") {
            "libonnxruntime.dylib"
          } else {
            "libonnxruntime.so"
          };

          match app_handle.path().resolve(lib_name, BaseDirectory::Resource) {
            Ok(resource_path) => {
              println!(
                "[ORT] Background init: attempting to load {lib_name} from: {:?}",
                resource_path
              );
              if resource_path.exists() {
                if let Err(e) = ort::init_from(resource_path.to_string_lossy().as_ref()).commit() {
                  eprintln!("[WARN] ORT background init failed: {}", e);
                } else {
                  println!("[ORT] Background init succeeded");
                }
              } else {
                eprintln!("[WARN] ORT library not found at {:?}", resource_path);
              }
            }
            Err(e) => {
              eprintln!("[WARN] ORT resource resolve failed: {}", e);
            }
          }
        }
      });

      // 托盘图标统一由前端控制，避免与后端重复创建导致出现多个托盘图标

      Ok(())
    })
    .on_page_load(|webview, payload| {
      if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
        if let Some(state) = webview.app_handle().try_state::<onnx_logic::OnnxState>() {
          if let Err(error) = state.release_view(webview.label()) {
            log::warn!("ONNX navigation cleanup failed: {error}");
          }
        }
      }
    })
    .on_window_event(|window, event| {
      // Only read local labels/state here, never query platform window geometry.
      if matches!(event, tauri::WindowEvent::Destroyed) {
        if let Some(state) = window.app_handle().try_state::<onnx_logic::OnnxState>() {
          if let Err(error) = state.release_window(window.label()) {
            log::warn!("ONNX window cleanup failed: {error}");
          }
        }
        // The native handle dies with its window, and `sync_corner_radius` cannot ask Tauri
        // whether it is still there (see `macos_window`): forget it here, or a resize that
        // lands afterwards messages a released `NSWindow`.
        #[cfg(target_os = "macos")]
        macos_window::forget_window(window.label());
      }
      #[cfg(target_os = "macos")]
      {
        if matches!(event, tauri::WindowEvent::Resized(_)) {
          // No window handle is passed on purpose: see macos_window.rs.
          let _ = window;
          macos_window::sync_corner_radius();
        }
      }
      #[cfg(not(target_os = "macos"))]
      {
        let _ = (window, event);
      }
    })
    // 启用 Tauri Updater 插件（仅桌面平台有效）
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_store::Builder::new().build())
    .plugin(tauri_plugin_upload::init())
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(
      tauri_plugin_log::Builder::new()
        .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
        // 设置日志等级：开发环境 Info，生产环境 Info（如需更详细再用 set_log_level 动态提升）
        .level(LevelFilter::Info)
        .format(|out, message, record| {
          // 生成本地时间戳，失败时退回到 UTC
          let ts = OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc());
          let ts_str = ts.format(&Rfc3339).unwrap_or_else(|_| "-".into());
          out.finish(format_args!(
            "[{}][{}][{}] {}",
            ts_str,
            record.level(),
            record.target(),
            message
          ))
        })
        .targets([
          // 输出到终端
          Target::new(TargetKind::Stdout),
          // 输出到webview控制台
          Target::new(TargetKind::Webview),
          // 输出到日志文件
          Target::new(TargetKind::LogDir {
            file_name: Some("logs".to_string()),
          }),
        ])
        .max_file_size(10 * 1024 * 1024) // 10MB
        // 日志轮转与保留策略：限制单文件大小，并仅保留当前日志文件（旧文件在轮转时删除）
        .max_file_size(2 * 1024 * 1024) // 2MB 每个日志文件
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
        .build(),
    )
    .manage(onnx_logic::OnnxState::default())
    .manage(sse::AppState::new())
    .manage(mcp::state::McpState::new())
    .manage(filesystem::state::FilesystemAllowlistState::default())
    .invoke_handler(tauri::generate_handler![
      greet,
      cleanup_on_exit,
      exit,
      set_log_level,
      // —— Window Commands ——
      window_fit::window_work_area,
      window_fit::apply_window_size,
      // —— Environment Check Commands ——
      check_npx_availability,
      get_environment_health,
      can_run_mcp_services,
      // —— MCP Commands ——
      mcp::commands::mcp_connect,
      mcp::commands::mcp_disconnect,
      mcp::commands::mcp_list_tools,
      mcp::commands::mcp_call_tool,
      mcp::commands::mcp_list_resources,
      mcp::commands::mcp_read_resource,
      mcp::commands::mcp_list_prompts,
      mcp::commands::mcp_get_prompt,
      // Document parser commands
      document_parser::parse_document_text,
      document_parser::parse_document_from_binary,
      document_parser::parse_document_content,
      document_parser::get_supported_file_types,
      document_structured::parse_document_structured,
      document_structured::tokenize_for_fts_command,
      // ONNX commands
      onnx_logic::get_onnx_view_generation,
      onnx_logic::init_onnx_session,
      onnx_logic::tokenize_batch,
      onnx_logic::count_embedding_tokens,
      onnx_logic::generate_embedding,
      onnx_logic::release_onnx_session,
      // —— SSE Commands ——
      sse::start_sse,
      sse::stop_sse,
      sse::start_local_sse_server,
      sse::start_local_mcp_sse,
      agent_runtime::agent_create_run,
      agent_runtime::agent_append_event,
      agent_runtime::agent_commit_model_step,
      agent_runtime::agent_set_run_status,
      agent_runtime::agent_save_checkpoint,
      agent_runtime::agent_request_approval,
      agent_runtime::agent_decide_approval,
      agent_runtime::publish_document_batch,
      agent_runtime::delete_document_atomically,
      agent_runtime::store_document_embeddings,
      agent_runtime::prepare_semantic_indexing,
      agent_runtime::claim_semantic_model,
      agent_runtime::dense_search_document_chunks,
      agent_runtime::cancel_dense_search,
      // —— HTTP Client Commands ——
      http_client::get_http_client_info,
      http_client::test_http_client,
      http_client::compare_http_clients,
      http_request::send_http_request,
      // —— Native Web Search ——
      web_search::commands::native_web_search,
      web_search::commands::native_web_fetch,
      web_search::commands::duckrush_search_api,
      // —— Sandbox Commands ——
      sandbox::commands::run_safe_shell,
      sandbox::commands::cancel_safe_shell,
      sandbox::commands::start_shell_process,
      sandbox::commands::read_shell_process,
      sandbox::commands::stop_shell_process,
      sandbox::commands::list_shell_processes,
      sandbox::commands::stop_conversation_processes,
      sandbox::commands::validate_command,
      sandbox::commands::check_runtime_environment,
      // —— Filesystem (backend commands, allowlist enforced) ——
      filesystem::commands::filesystem_set_allowlist,
      filesystem::commands::filesystem_grant_call_scope,
      filesystem::commands::filesystem_revoke_call_scope,
      filesystem::commands::filesystem_read_file,
      filesystem::commands::filesystem_write_file,
      filesystem::commands::filesystem_edit_file,
      filesystem::commands::filesystem_search_files,
      filesystem::commands::filesystem_list_directory,
      filesystem::commands::filesystem_create_directory,
      filesystem::commands::filesystem_delete_file,
      filesystem::commands::filesystem_delete_many,
      filesystem::commands::filesystem_delete_by_pattern,
      filesystem::commands::filesystem_rename_file,
      filesystem::commands::filesystem_file_history,
      filesystem::commands::filesystem_restore_file_version,
      filesystem::commands::filesystem_open_path,
      // —— Session workspace (Documents/Chatless, Rust-owned identity) ——
      workspace::commands::workspace_ensure,
      workspace::commands::workspace_export,
      workspace::commands::workspace_trash,
      workspace::commands::workspace_trash_all,
      workspace::commands::workspace_reveal,
      workspace::commands::workspace_read_manifest,
      workspace::commands::workspace_write_manifest
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|app_handle, event| match event {
    tauri::RunEvent::ExitRequested { code, .. } => {
      if code == Some(tauri::RESTART_EXIT_CODE) {
        RESTARTING.store(true, Ordering::SeqCst);
      } else if let Some(code) = code {
        EXIT_CODE.store(code, Ordering::Relaxed);
      }
    }
    tauri::RunEvent::Exit => {
      // Restarting re-executes the process from here, which is tauri's job, not ours.
      if RESTARTING.load(Ordering::SeqCst) {
        return;
      }
      log::info!("[app] exiting");
      let _ = std::io::stdout().flush();
      let _ = std::io::stderr().flush();
      // Plugin and window resources go first: this is what flushes the settings stores and
      // drops the tray icon, and it has to happen on this thread (the event loop's own).
      app_handle.cleanup_before_exit();
      // Then leave through the syscall. ONNX Runtime is loaded dynamically and never
      // unloaded - `ort` parks the `libloading::Library` handle in a `OnceLock` - so
      // returning from `main` would run the runtime's C++ static destructors while its own
      // threads are still locking them. The first lock on a destroyed `std::mutex` throws a
      // libc++ `system_error` across Rust frames, `std::terminate` follows, and macOS
      // reported "Chatless quit unexpectedly" after every quit: see docs/macos-exit-crash.md.
      // Anything that must reach disk has to be written by then - `_exit` runs no `atexit`
      // handler and flushes no buffer.
      unsafe { libc::_exit(EXIT_CODE.load(Ordering::Relaxed)) };
    }
    _ => {}
  });
}

/// 动态设置日志级别（支持在运行时从前端调整）
#[tauri::command]
fn set_log_level(level: &str) -> Result<(), String> {
  let lvl = match level.to_lowercase().as_str() {
    "trace" => LevelFilter::Trace,
    "debug" => LevelFilter::Debug,
    "info" => LevelFilter::Info,
    "warn" => LevelFilter::Warn,
    "error" => LevelFilter::Error,
    "none" => LevelFilter::Off,
    _ => LevelFilter::Info,
  };

  log::set_max_level(lvl);
  Ok(())
}
