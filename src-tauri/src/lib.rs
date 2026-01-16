// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use anyhow::Result;
use crc32fast;
use log::LevelFilter;
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

#[tauri::command]
fn exit(app: tauri::AppHandle, code: i32) {
  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  {
    use tauri_plugin_window_state::{AppHandleExt, StateFlags};
    let _ = app.save_window_state(StateFlags::all());
  }
  std::process::exit(code);
}

#[path = "lib/onnx_logic.rs"]
pub mod onnx_logic;

#[path = "lib/document_parser.rs"]
pub mod document_parser;

#[path = "lib/sse.rs"]
pub mod sse;

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

/// Tauri 命令：使用模拟数据生成嵌入向量（用于测试和回退）
#[tauri::command]
fn generate_embedding_command(texts: Vec<String>) -> Result<Vec<Vec<f32>>, String> {
  // 为每个输入文本生成一个384维的模拟嵌入向量
  let embeddings = texts
    .iter()
    .map(|text| {
      // 使用文本的哈希值或其他属性来生成确定性的、但看起来随机的向量
      let hash = crc32fast::hash(text.as_bytes());
      let mut vec = vec![0.0f32; 384];
      let mut val = (hash as f32) / (u32::MAX as f32) - 0.5;
      for i in 0..384 {
        vec[i] = val;
        val = (val * 1.1 + 0.1).sin();
      }
      vec
    })
    .collect();
  Ok(embeddings)
}

pub fn run() {
  let _builder = tauri::Builder::default()
    .plugin(tauri_plugin_os::init())
    .plugin(tauri_plugin_process::init())
    .setup(|app| {
      #[cfg(not(any(target_os = "android", target_os = "ios")))]
      {
        let _ = app
          .handle()
          .plugin(tauri_plugin_window_state::Builder::default().build());
        // 主动恢复一次，确保未被其他初始化逻辑覆盖
        {
          use tauri_plugin_window_state::{WindowExt, StateFlags};
          if let Some(win) = app.get_webview_window("main") {
            let _ = win.restore_state(StateFlags::all());
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

          match app_handle
            .path()
            .resolve(lib_name, BaseDirectory::Resource)
          {
            Ok(resource_path) => {
              println!("[ORT] Background init: attempting to load {lib_name} from: {:?}", resource_path);
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
    .manage(onnx_logic::OnnxState {
      session: Default::default(),
      attention_mask: Default::default(),
      token_type_ids: Default::default(),
    })
    .manage(sse::AppState::new())
    .manage(mcp::state::McpState::new())
    .invoke_handler(tauri::generate_handler![
      greet,
      generate_embedding_command,
      exit,
      set_log_level,
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
      // ONNX commands
      onnx_logic::init_onnx_session,
      onnx_logic::tokenize_batch,
      onnx_logic::generate_embedding,
      onnx_logic::release_onnx_session,
      // —— SSE Commands ——
      sse::start_sse,
      sse::stop_sse,
      sse::start_local_sse_server,
      sse::start_local_mcp_sse,
      // —— HTTP Client Commands ——
      http_client::get_http_client_info,
      http_client::test_http_client,
      http_client::compare_http_clients,
      http_request::send_http_request
      ,
      // —— Native Web Search ——
      web_search::commands::native_web_search,
      web_search::commands::native_web_fetch,
      web_search::commands::duckrush_search_api
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
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
