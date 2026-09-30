// src-tauri/src/lib/sse.rs
use futures_util::StreamExt;
use lazy_static::lazy_static;
use reqwest::Method;
use rmcp::{
  model::{ServerCapabilities, ServerInfo},
  transport::sse_server::SseServer,
  ServerHandler,
};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio::sync::broadcast;

lazy_static! {
    // 可选：如果需要本地测试服务器，这里保留子进程句柄
    pub static ref SERVER_CHILD: std::sync::Mutex<Option<std::process::Child>> = std::sync::Mutex::new(None);
}

/// 每个请求独立的关闭信号，避免停止一个模型请求时误伤其他请求。
pub struct AppState {
  pub sse_shutdown_senders: Mutex<HashMap<String, broadcast::Sender<()>>>,
}

impl AppState {
  pub fn new() -> Self {
    Self {
      sse_shutdown_senders: Mutex::new(HashMap::new()),
    }
  }
}

/// 启动 SSE 连接
///
/// * `url`     – 完整的 SSE 端点
/// * `method`  – Optional: GET / POST / ...（默认 GET）
/// * `headers` – Optional: 附加请求头
/// * `body`    – Optional: JSON body（POST 时常用）
/// * `proxy_url` – Optional: 自定义代理（例如 http://127.0.0.1:7890），若为空则不使用自定义代理
#[tauri::command]
pub async fn start_sse(
  app: AppHandle,
  state: State<'_, AppState>,
  url: String,
  method: Option<String>,
  headers: Option<HashMap<String, String>>,
  body: Option<Value>,
  proxy_url: Option<String>,
  request_id: Option<String>,
) -> Result<(), String> {
  let request_id = request_id.filter(|id| !id.trim().is_empty()).unwrap_or_else(|| format!("sse-{}", std::process::id()));
  let event_request_id = request_id.clone();
  let event_name = move |kind: &str| format!("sse-{}-{}", kind, event_request_id);

  // 新建广播通道用于优雅关闭
  let (shutdown_tx, mut shutdown_rx) = broadcast::channel(1);
  if let Ok(mut guard) = state.sse_shutdown_senders.lock() {
    // 同一 request_id 重启时只关闭该请求的旧连接。
    if let Some(previous) = guard.insert(request_id.clone(), shutdown_tx) {
      let _ = previous.send(());
    }
  }

  // 选择HTTP客户端：优先使用携带代理的自定义客户端；否则回退到最小化客户端
  let client = if let Some(p) = proxy_url.clone().filter(|s| !s.is_empty()) {
    let mut cfg = crate::http_client::HttpClientConfig::default();
    cfg.http1_only = true;
    cfg.gzip = false;
    cfg.brotli = false;
    cfg.proxy_url = Some(p);

    match crate::http_client::HttpClientManager::build_custom_client(cfg) {
      Ok(client) => client,
      Err(e) => {
        app.emit(&event_name("error"), format!("Failed to build HTTP client with proxy: {}", e)).ok();
        app.emit(&event_name("status"), "closed").ok();
        if let Ok(mut guard) = state.sse_shutdown_senders.lock() {
          guard.remove(&request_id);
        }
        return Err(format!("Failed to build HTTP client with proxy: {}", e));
      }
    }
  } else {
    match crate::http_client::get_minimal_client() {
      Ok(client) => (*client).clone(), // 从Arc<Client>转换为Client
      Err(e) => {
        app.emit(&event_name("error"), format!("Failed to get HTTP client: {}", e)).ok();
        app.emit(&event_name("status"), "closed").ok();
        if let Ok(mut guard) = state.sse_shutdown_senders.lock() {
          guard.remove(&request_id);
        }
        return Err(format!("Failed to get HTTP client: {}", e));
      }
    }
  };

  // 在后台任务中拉取 SSE 数据并通过 Tauri Event 转发给前端
  tauri::async_runtime::spawn(async move {
    app.emit(&event_name("status"), "Connecting...").ok();

    // ---------- 构造请求 ----------
    let http_method = method.unwrap_or_else(|| "GET".to_string()).to_uppercase();
    let mut req_builder = match http_method.as_str() {
      "POST" => client.post(&url),
      "PUT" => client.request(Method::PUT, &url),
      _ => client.get(&url),
    };

    // Accept 头确保 SSE，且禁用压缩，避免解压中途失败导致的 "error decoding response body"
    req_builder = req_builder
      .header("Accept", "text/event-stream")
      .header("Accept-Encoding", "identity")
      // 为长回复流设置更长的单请求超时（30分钟）
      .timeout(Duration::from_secs(30 * 60));

    // 追加自定义头
    if let Some(hdrs) = &headers {
      for (k, v) in hdrs {
        req_builder = req_builder.header(k, v);
      }
    }

    // 若有 body 且为 POST/PUT，则附加 JSON
    if matches!(http_method.as_str(), "POST" | "PUT") {
      if let Some(b) = &body {
        req_builder = req_builder.json(b);
      }
    }

    // Cancellation must also interrupt DNS/TLS/response-header wait, not only
    // the already-open response stream.
    let response = tokio::select! {
      _ = shutdown_rx.recv() => {
        app.emit(&event_name("status"), "cancelled").ok();
        if let Ok(mut guard) = app.state::<AppState>().sse_shutdown_senders.lock() {
          guard.remove(&request_id);
        }
        return;
      },
      result = req_builder.send() => result,
    };
    let res = match response {
      Ok(r) => r,
      Err(e) => {
        app.emit(&event_name("error"), e.to_string()).ok();
        app.emit(&event_name("status"), "closed").ok();
        if let Ok(mut guard) = app.state::<AppState>().sse_shutdown_senders.lock() {
          guard.remove(&request_id);
        }
        return;
      }
    };

    // 移除额外的响应头日志（保留修复性改动）

    if !res.status().is_success() {
      let status = res.status();
      let body_text = res.text().await.unwrap_or_default();
      let full_msg = format!("HTTP {}: {}", status, body_text);
      app.emit(&event_name("error"), full_msg).ok();
      app.emit(&event_name("status"), "closed").ok();
      if let Ok(mut guard) = app.state::<AppState>().sse_shutdown_senders.lock() {
        guard.remove(&request_id);
      }
      return;
    }
    app
      .emit(&event_name("status"), "Connected. Listening for events...")
      .ok();

    let mut stream = res.bytes_stream();
    // 跨 chunk 行缓冲，避免一行在两个 chunk 之间被拆分导致上层解析失败
    let mut line_buffer = Vec::<u8>::new();
    loop {
      tokio::select! {
          _ = shutdown_rx.recv() => {
              app.emit(&event_name("status"), "cancelled").ok();
              break;
          },
          item = stream.next() => {
              match item {
                  // `StreamExt::next()` resolves to None at transport EOF.  A
                  // `Some(item) = ...` pattern disables that branch instead,
                  // leaving the cancellation receiver pending forever.
                  None => break,
                  Some(item) => match item {
                  Ok(bytes) => {
                      line_buffer.extend_from_slice(&bytes);
                      while let Some(pos) = line_buffer.iter().position(|byte| *byte == b'\n') {
                          let mut raw_line: Vec<u8> = line_buffer.drain(..=pos).collect();
                          raw_line.pop(); // newline
                          if raw_line.last() == Some(&b'\r') { raw_line.pop(); }
                          // Decode only after receiving the full line. A UTF-8
                          // character may legitimately span transport chunks.
                          let line = String::from_utf8_lossy(&raw_line);
                          let payload = if let Some(data) = line.strip_prefix("data:") {
                              data.trim()
                          } else {
                              // 对于 Ollama 这类直接返回 JSON 行的情况，整行即为数据
                              line.trim()
                          };

                          if !payload.is_empty() {
                              app.emit(&event_name("event"), payload.to_string()).ok();
                          }
                      }
                  },
                  Err(e) => {
                      app.emit(&event_name("error"), e.to_string()).ok();
                      break;
                  }
                }
              }
          },
      }
    }

    // ✅ 关键修复：连接自然结束时，可能存在最后一行没有以 '\n' 结尾（例如 "[DONE]"），
    // 这会导致前端永远收不到收尾信号，从而出现“服务端已完成但前端还在加载/追赶输出”的现象。
    // 在结束前补一次冲刷，确保最后一行也会被发出。
    {
      let line = String::from_utf8_lossy(&line_buffer).trim().to_string();
      if !line.is_empty() {
        let payload = if let Some(data) = line.strip_prefix("data:") {
          data.trim()
        } else {
          line.trim()
        };
        if !payload.is_empty() {
          app.emit(&event_name("event"), payload.to_string()).ok();
        }
      }
    }

    // 连接自然结束
    app.emit(&event_name("status"), "closed").ok();
    if let Ok(mut guard) = app.state::<AppState>().sse_shutdown_senders.lock() {
      guard.remove(&request_id);
    }
  });

  Ok(())
}

/// 停止 SSE 连接的命令
#[tauri::command]
pub async fn stop_sse(state: State<'_, AppState>, request_id: Option<String>) -> Result<(), String> {
  match state.sse_shutdown_senders.lock() {
    Ok(mut guard) => {
      let key = request_id.filter(|id| !id.trim().is_empty()).unwrap_or_else(|| "sse-default".to_string());
      if let Some(sender) = guard.remove(&key) {
        sender.send(()).map_err(|e| e.to_string())?;
        Ok(())
      } else {
        Err("No active SSE connection to stop.".into())
      }
    }
    Err(e) => Err(format!("Failed to acquire lock: {}", e)),
  }
}

/// 启动一个极简本地 SSE 测试服务（仅开发用途）
/// - address: 例如 "127.0.0.1:8787"
/// 端点：/sse 返回 `text/event-stream`，每秒发送一条计数数据
#[tauri::command]
pub async fn start_local_sse_server(address: String) -> Result<(), String> {
  let listener = TcpListener::bind(&address)
    .await
    .map_err(|e| format!("bind {} failed: {}", address, e))?;

  tauri::async_runtime::spawn(async move {
    let mut counter: u64 = 0;
    loop {
      let Ok((mut socket, _)) = listener.accept().await else {
        continue;
      };
      tauri::async_runtime::spawn(async move {
        let mut buf = [0u8; 1024];
        // 读取一次请求（忽略请求体与路径解析，简单匹配 /sse）
        let _ = socket.readable().await;
        let _ = socket.try_read(&mut buf);

        let _ = socket
          .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n")
          .await;

        // 简单循环发送事件
        loop {
          counter += 1;
          let line = format!("data: test-event {}\n\n", counter);
          if socket.write_all(line.as_bytes()).await.is_err() {
            break;
          }
          tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
        }
      });
    }
  });

  Ok(())
}

/// 启动一个“最小 MCP SSE 服务器”（工具为空，仅用于握手验证）
#[tauri::command]
pub async fn start_local_mcp_sse(address: String) -> Result<(), String> {
  // 使用 rmcp 的 SseServer（真实 MCP SSE 管道），提供一个空 ServerHandler
  struct Dummy;
  impl ServerHandler for Dummy {
    fn get_info(&self) -> ServerInfo {
      ServerInfo {
        capabilities: ServerCapabilities::builder().enable_tools().build(),
        instructions: Some("Dummy MCP SSE server".into()),
        ..Default::default()
      }
    }
  }

  let bind: std::net::SocketAddr = address
    .parse()
    .map_err(|e| format!("invalid address {}: {}", address, e))?;
  let sse = SseServer::serve(bind)
    .await
    .map_err(|e| format!("start sse failed: {}", e))?;
  let _ct = sse.with_service::<Dummy, _>(|| Dummy);
  Ok(())
}
