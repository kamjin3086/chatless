use crate::env_setup::EnvironmentSetup;
use crate::mcp::state::{McpService, McpState};
use crate::mcp::types::McpServerConfig;
use rmcp::{
  model::{
    CallToolRequestParam, GetPromptRequestParam, ListToolsResult, ReadResourceRequestParam, Tool,
  },
  service::ServiceExt,
  transport::{
    sse_client::{SseClientConfig, SseClientTransport},
    streamable_http_client::{StreamableHttpClientTransport, StreamableHttpClientTransportConfig},
    ConfigureCommandExt, TokioChildProcess,
  },
};
// use std::sync::Arc; // no longer needed after using with_uri
use reqwest::Url;
use std::net::IpAddr;
use tauri::State;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

// —— 工具：从 npx 参数中提取第一个包名（用于首次安装的预拉取） ——
fn extract_npx_package(args: &Option<Vec<String>>) -> Option<String> {
  if let Some(a) = args {
    for it in a {
      // 跳过常见的 flags（以 - 开头）
      if it.starts_with('-') {
        continue;
      }
      return Some(it.clone());
    }
  }
  None
}

async fn npx_prefetch_package(pkg: &str) -> Result<(), String> {
  // 只下载依赖，不启动 MCP；最长等待 4 分钟以适配首次安装
  let mut pre = Command::new("npx");

  // [关键步骤] 为Windows平台设置无窗口创建标志
  #[cfg(windows)]
  {
    pre.creation_flags(0x08000000); // CREATE_NO_WINDOW
  }

  pre.env("NPM_CONFIG_LOGLEVEL", "silent");
  pre.env("NO_COLOR", "1");
  pre.env("NPX_Y", "1");
  pre.args(["-y", "-p", pkg, "node", "-e", "process.exit(0)"]);
  log::info!("[MCP/npx] prefetch package: {}", pkg);
  let status = timeout(Duration::from_secs(240), pre.status())
    .await
    .map_err(|_| "npx prefetch timeout".to_string())?
    .map_err(|e| e.to_string())?;
  if !status.success() {
    return Err(format!("npx prefetch failed with code {:?}", status.code()));
  }
  Ok(())
}

fn is_path_like(arg: &str) -> bool {
  if arg.is_empty() {
    return false;
  }
  let lower = arg.to_lowercase();
  if lower.starts_with("http://") || lower.starts_with("https://") {
    return false;
  }
  // npm scope 包名，如 @scope/name，不应被当作路径
  if arg.starts_with('@') {
    // 典型包名不包含反斜杠和盘符
    if arg.contains('/') && !arg.contains('\\') && !arg.contains(':') {
      return false;
    }
  }
  if arg.starts_with('/')
    || arg.starts_with("./")
    || arg.starts_with("../")
    || arg.starts_with("~/")
  {
    return true;
  }
  // Windows 盘符，如 C:\ 或 C:/
  if arg.len() >= 3 {
    let bytes = arg.as_bytes();
    if bytes[1] == b':' && (bytes[2] == b'/' || bytes[2] == b'\\') {
      return true;
    }
  }
  // 包含路径分隔符的其它情况
  arg.contains('/') || arg.contains('\\')
}

#[tauri::command]
pub async fn mcp_connect(
  name: String,
  config: McpServerConfig,
  state: State<'_, McpState>,
) -> Result<(), String> {
  log::info!(
    "[MCP] Starting connection to server: {} with type: {}",
    name,
    config.r#type
  );
  log::debug!("[MCP] Full config: {:?}", config);

  if state.0.contains_key(&name) {
    log::info!("[MCP] Server {} already connected, skipping", name);
    return Ok(());
  }

  // 检查环境是否支持 MCP 服务
  if !crate::env_setup::can_run_mcp_services() {
    let health = crate::env_setup::get_environment_health();
    let missing_tools = health.missing_critical_tools.join(", ");
    let recommendations = health.recommendations.join("\n");

    let error_msg = format!(
      "Cannot connect to MCP server: Required tools are missing: {}\n\nInstallation recommendations:\n{}",
      missing_tools, recommendations
    );

    log::error!("[MCP] {}", error_msg);
    return Err(error_msg);
  }

  match config.r#type.as_str() {
    "stdio" => {
      log::info!(
        "[MCP/stdio] Initializing stdio connection for server: {}",
        name
      );

      let cmd_name = config
        .command
        .clone()
        .ok_or_else(|| "command required for stdio".to_string())?;
      log::info!("[MCP/stdio] Command name: {}", cmd_name);

      // —— 基础安全校验：仅允许白名单命令或显式路径；另允许 Windows 包装器 cmd /c ——
      let is_path = cmd_name.contains('/') || cmd_name.contains('\\');
      log::debug!("[MCP/stdio] Command is_path: {}", is_path);

      if !is_path {
        const ALLOW: [&str; 3] = ["npx", "uvx", "bunx"];
        let is_wrapper_cmd = cmd_name.eq_ignore_ascii_case("cmd")
          && config
            .args
            .as_ref()
            .map(|a| {
              a.get(0)
                .map(|s| s.eq_ignore_ascii_case("/c"))
                .unwrap_or(false)
            })
            .unwrap_or(false)
          && config.args.as_ref().map(|a| a.len() >= 2).unwrap_or(false);

        log::debug!("[MCP/stdio] Is wrapper cmd: {}", is_wrapper_cmd);
        log::debug!("[MCP/stdio] Allowed commands: {:?}", ALLOW);

        if !ALLOW.contains(&cmd_name.as_str()) && !is_wrapper_cmd {
          let error_msg = format!(
            "command '{}' is not allowed. use one of: npx, uvx, bunx, an absolute path, or Windows wrapper 'cmd /c <cmd>'",
            cmd_name
          );
          log::error!("[MCP/stdio] Security check failed: {}", error_msg);
          return Err(error_msg);
        }
      }

      // 构造命令的闭包，便于重试
      let build_cmd = || {
        log::debug!("[MCP/stdio] Building command: {}", cmd_name);

        let mut c = Command::new(&cmd_name);

        // [关键步骤] 为Windows平台设置无窗口创建标志
        #[cfg(windows)]
        {
          c.creation_flags(0x08000000); // CREATE_NO_WINDOW
          log::debug!("[MCP/stdio] Set Windows CREATE_NO_WINDOW flag");
        }

        // 动态设置环境变量，特别是对于 npm 相关命令
        if cmd_name == "npx" || cmd_name == "npm" || cmd_name == "node" {
          log::debug!(
            "[MCP/stdio] Setting up environment for {} command",
            cmd_name
          );

          // 获取当前环境设置（用于调试）
          let _current_path = std::env::var("PATH").unwrap_or_default();

          // 如果检测到工具不可用，尝试重新设置环境
          let env_checker = EnvironmentSetup::new();
          if !env_checker.verify_tool_availability(&cmd_name) {
            log::warn!(
              "[MCP/stdio] Tool {} not found in current PATH, attempting to refresh environment",
              cmd_name
            );

            // 尝试设置环境变量
            if let Ok(()) = EnvironmentSetup::new().setup() {
              // 重新获取环境设置以获取更新后的 PATH
              let updated_env = EnvironmentSetup::new();
              let updated_path = updated_env.get_updated_path();
              c.env("PATH", updated_path);
              log::info!("[MCP/stdio] Updated PATH for {} command", cmd_name);
            } else {
              log::warn!(
                "[MCP/stdio] Failed to setup environment for {} command",
                cmd_name
              );
            }
          } else {
            log::debug!("[MCP/stdio] Tool {} is available in current PATH", cmd_name);
          }
        }

        if let Some(args) = &config.args {
          c.args(args);
          log::debug!("[MCP/stdio] Added args: {:?}", args);
        }

        if let Some(envs) = &config.env {
          for (k, v) in envs {
            c.env(k, v);
            log::debug!("[MCP/stdio] Set env: {}={}", k, v);
          }
        }

        if cmd_name == "npx" {
          c.env("NPM_CONFIG_LOGLEVEL", "silent");
          c.env("NO_COLOR", "1");
          c.env("NPX_Y", "1");
          log::debug!("[MCP/stdio] Set npx-specific environment variables");
        }

        // Log the final command for debugging
        log::info!("[MCP/stdio] Built command: {} {:?}", cmd_name, config.args);

        c
      };

      // —— 参数校验，避免简单的 shell 注入字符 ——
      if let Some(args) = &config.args {
        log::debug!("[MCP/stdio] Validating arguments: {:?}", args);

        let joined = args.join(" ");
        if joined.len() > 2048 {
          let error_msg = "args too long".to_string();
          log::error!("[MCP/stdio] Args validation failed: {}", error_msg);
          return Err(error_msg);
        }

        if joined.contains('|')
          || joined.contains('&')
          || joined.contains(';')
          || joined.contains('>')
          || joined.contains('<')
        {
          let error_msg = "args contains forbidden shell characters".to_string();
          log::error!("[MCP/stdio] Args validation failed: {}", error_msg);
          return Err(error_msg);
        }

        // 通用路径存在性校验：检测看起来像路径的参数，如果不存在则直接提示（避免特定 MCP 魔法处理）
        // 规则：从第一个非 flag 参数（一般是包名）之后的参数中筛选
        // Windows 包装器 cmd /c <cmd> <args...> 需要跳过前两个参数
        let wrapper_offset = if cmd_name.eq_ignore_ascii_case("cmd")
          && args
            .get(0)
            .map(|s| s.eq_ignore_ascii_case("/c"))
            .unwrap_or(false)
          && args.len() >= 2
        {
          2
        } else {
          0
        };

        log::debug!("[MCP/stdio] Wrapper offset: {}", wrapper_offset);

        let args_slice = &args[wrapper_offset..];
        let mut first_non_flag_in_slice: Option<usize> = None;
        for (i, it) in args_slice.iter().enumerate() {
          if !it.starts_with('-') {
            first_non_flag_in_slice = Some(i);
            break;
          }
        }

        if let Some(mut idx) = first_non_flag_in_slice {
          log::debug!("[MCP/stdio] First non-flag arg index: {}", idx);

          // 特判：cmd /c + npx/uvx/bunx 的形式。此时 idx 指向的是执行器（npx），
          // 需要继续向后找到真正的包名（第一个非 flag），并从包名之后开始校验路径。
          if args_slice
            .get(idx)
            .map(|s| s.as_str())
            .map(|s| {
              s.eq_ignore_ascii_case("npx")
                || s.eq_ignore_ascii_case("uvx")
                || s.eq_ignore_ascii_case("bunx")
            })
            .unwrap_or(false)
          {
            let mut pkg_idx_in_slice: Option<usize> = None;
            for (j, it) in args_slice.iter().enumerate().skip(idx + 1) {
              if !it.starts_with('-') {
                pkg_idx_in_slice = Some(j);
                break;
              }
            }
            if let Some(pidx) = pkg_idx_in_slice {
              idx = pidx;
              log::debug!("[MCP/stdio] Adjusted package index to: {}", idx);
            }
          }

          let start = wrapper_offset + idx + 1; // 从包名后的参数开始
          log::debug!("[MCP/stdio] Path validation start index: {}", start);

          if start < args.len() {
            let mut missing: Vec<String> = Vec::new();
            for raw in &args[start..] {
              if is_path_like(raw) {
                log::debug!("[MCP/stdio] Checking path-like argument: {}", raw);
                // 直接按原样检查（不展开 ~ 等），以避免误判和隐式替换
                match tokio::fs::metadata(raw).await {
                  Ok(metadata) => {
                    log::debug!(
                      "[MCP/stdio] Path exists: {} (type: {:?})",
                      raw,
                      metadata.file_type()
                    );
                  }
                  Err(e) => {
                    log::warn!("[MCP/stdio] Path does not exist: {} (error: {})", raw, e);
                    missing.push(raw.clone());
                  }
                }
              }
            }

            if !missing.is_empty() {
              let mut msg = format!("Path arguments do not exist: {}", missing.join(", "));
              let placeholder_hits: Vec<&str> = missing
                .iter()
                .filter_map(|s| {
                  let ls = s.to_lowercase();
                  if ls.contains("/users/username/") || ls.contains("path/to/other/allowed/dir") {
                    Some(s.as_str())
                  } else {
                    None
                  }
                })
                .collect();
              if !placeholder_hits.is_empty() {
                msg.push_str(". It looks like placeholder paths are still present. Please replace them with real existing directories.");
              }
              log::error!("[MCP/stdio] Path validation failed: {}", msg);
              return Err(msg);
            }
          }
        }
      }

      // —— 调试日志 ——
      log::info!("[MCP/stdio] Command validation passed, spawning process");
      log::debug!(
        "[MCP/stdio] Final command details: cmd='{}' args={:?} envs={}",
        cmd_name,
        &config.args,
        config.env.as_ref().map(|v| v.len()).unwrap_or(0)
      );

      // 一次尝试的封装
      let try_connect = || async {
        log::debug!("[MCP/stdio] Attempting to spawn child process");
        let cmd = build_cmd();

        // Log current working directory and environment for debugging
        if let Ok(current_dir) = std::env::current_dir() {
          log::debug!("[MCP/stdio] Current working directory: {:?}", current_dir);
        }

        if let Ok(path) = std::env::var("PATH") {
          log::debug!("[MCP/stdio] PATH environment: {}", path);
        }

        match TokioChildProcess::new(cmd.configure(|_c| {})) {
          Ok(process) => {
            log::debug!("[MCP/stdio] Child process created successfully");
            let service: McpService = ().serve(process).await.map_err(|e| {
              log::error!("[MCP/stdio] Service creation failed: {}", e);
              e.to_string()
            })?;
            log::info!("[MCP/stdio] MCP service created successfully");
            Ok::<McpService, String>(service)
          }
          Err(e) => {
            log::error!("[MCP/stdio] Failed to create child process: {}", e);
            Err(e.to_string())
          }
        }
      };

      // 第一次尝试（可能在 npx 首次下载时失败/超时）
      log::info!("[MCP/stdio] Starting first connection attempt with 30s timeout");
      let first = timeout(Duration::from_secs(30), try_connect())
        .await
        .map_err(|_| {
          log::error!("[MCP/stdio] First connection attempt timed out");
          "Connect timeout (stdio)".to_string()
        });

      match first {
        Ok(Ok(service)) => {
          log::info!(
            "[MCP/stdio] First connection attempt successful for server: {}",
            name
          );
          state.0.insert(name, service);
          Ok(())
        }
        Ok(Err(e)) | Err(e) => {
          log::warn!("[MCP/stdio] First connection attempt failed: {}", e);

          if cmd_name == "npx" {
            if let Some(pkg) = extract_npx_package(&config.args) {
              log::info!(
                "[MCP/stdio] First connect failed: {}. prefetching {}...",
                e,
                pkg
              );
              // 预下载失败则直接返回组合错误
              match npx_prefetch_package(&pkg).await {
                Ok(()) => {
                  log::info!("[MCP/stdio] Package prefetch successful, retrying connection");
                }
                Err(pe) => {
                  log::error!("[MCP/stdio] Package prefetch failed: {}", pe);
                  return Err(format!("{}; prefetch: {}", e, pe));
                }
              }

              // 预下载成功后重试
              log::info!("[MCP/stdio] Starting second connection attempt after prefetch");
              let second = timeout(Duration::from_secs(30), try_connect())
                .await
                .map_err(|_| {
                  log::error!("[MCP/stdio] Second connection attempt timed out");
                  "Connect timeout (stdio, after prefetch)".to_string()
                })??;

              log::info!(
                "[MCP/stdio] Second connection attempt successful for server: {}",
                name
              );
              state.0.insert(name, second);
              Ok(())
            } else {
              log::error!("[MCP/stdio] Failed to extract package name from npx args");
              Err(e)
            }
          } else {
            log::error!("[MCP/stdio] Connection failed and not using npx, cannot retry");
            Err(e)
          }
        }
      }
    }
    "sse" => {
      log::info!("[MCP/sse] Initializing SSE connection for server: {}", name);

      let base = config
        .base_url
        .clone()
        .ok_or_else(|| "baseUrl required for sse".to_string())?;
      log::info!("[MCP/sse] Connecting to baseUrl: {}", &base);

      // —— 代理选择策略：若 use_proxy=true 且 proxy_url 存在，且目标非本地/私网，则使用带代理客户端；否则使用浏览器化客户端 ——
      let should_use_proxy = {
        let enabled = config.use_proxy.unwrap_or(false) && config.proxy_url.is_some();
        if !enabled {
          false
        } else {
          match Url::parse(&base) {
            Ok(u) => {
              let host = u.host_str().unwrap_or_default();
              is_local_or_private(host) == false
            }
            Err(_) => {
              // 无法解析 URL，保守起见不走代理
              false
            }
          }
        }
      };

      let req = if should_use_proxy {
        let mut cfg = crate::http_client::HttpClientConfig::default();
        cfg.http1_only = true;
        cfg.gzip = false;
        cfg.brotli = false;
        cfg.proxy_url = config.proxy_url.clone();
        match crate::http_client::HttpClientManager::build_custom_client(cfg) {
          Ok(client) => {
            log::debug!("[MCP/sse] Using custom proxied HTTP client");
            std::sync::Arc::new(client)
          }
          Err(e) => {
            log::error!("[MCP/sse] Failed to build proxied client: {}", e);
            return Err(format!("Failed to build proxied client: {}", e));
          }
        }
      } else {
        match crate::http_client::get_browser_like_client() {
          Ok(client) => {
            log::debug!("[MCP/sse] Using browser-like HTTP client");
            client
          }
          Err(e) => {
            log::error!("[MCP/sse] Failed to get HTTP client: {}", e);
            return Err(format!("Failed to get HTTP client: {}", e));
          }
        }
      };

      let req = (*req).clone(); // 从Arc<Client>转换为Client
      let cfg = SseClientConfig {
        sse_endpoint: base.into(),
        ..Default::default()
      };
      log::debug!("[MCP/sse] SSE config: {:?}", cfg);

      let transport = match SseClientTransport::start_with_client(req, cfg).await {
        Ok(transport) => {
          log::debug!("[MCP/sse] SSE transport started successfully");
          transport
        }
        Err(e) => {
          log::error!("[MCP/sse] Failed to start SSE transport: {}", e);
          return Err(e.to_string());
        }
      };

      let service: McpService = match ().serve(transport).await {
        Ok(service) => {
          log::info!(
            "[MCP/sse] SSE service created successfully for server: {}",
            name
          );
          service
        }
        Err(e) => {
          log::error!("[MCP/sse] Failed to create SSE service: {}", e);
          return Err(e.to_string());
        }
      };

      state.0.insert(name.clone(), service);
      log::info!(
        "[MCP/sse] SSE connection established successfully for server: {}",
        name
      );
      Ok(())
    }
    "http" => {
      log::info!(
        "[MCP/http] Initializing HTTP connection for server: {}",
        name
      );

      let base = config
        .base_url
        .clone()
        .ok_or_else(|| "baseUrl required for http".to_string())?;
      log::info!("[MCP/http] Connecting to baseUrl: {}", &base);

      // —— 代理选择（同上） ——
      let should_use_proxy = {
        let enabled = config.use_proxy.unwrap_or(false) && config.proxy_url.is_some();
        if !enabled {
          false
        } else {
          match Url::parse(&base) {
            Ok(u) => {
              let host = u.host_str().unwrap_or_default();
              is_local_or_private(host) == false
            }
            Err(_) => false,
          }
        }
      };

      let req = if should_use_proxy {
        let mut cfg = crate::http_client::HttpClientConfig::default();
        cfg.http1_only = true;
        cfg.gzip = false;
        cfg.brotli = false;
        cfg.proxy_url = config.proxy_url.clone();
        match crate::http_client::HttpClientManager::build_custom_client(cfg) {
          Ok(client) => {
            log::debug!("[MCP/http] Using custom proxied HTTP client");
            std::sync::Arc::new(client)
          }
          Err(e) => {
            log::error!("[MCP/http] Failed to build proxied client: {}", e);
            return Err(format!("Failed to build proxied client: {}", e));
          }
        }
      } else {
        match crate::http_client::get_browser_like_client() {
          Ok(client) => {
            log::debug!("[MCP/http] Using browser-like HTTP client");
            client
          }
          Err(e) => {
            log::error!("[MCP/http] Failed to get HTTP client: {}", e);
            return Err(format!("Failed to get HTTP client: {}", e));
          }
        }
      };

      let req = (*req).clone(); // 从Arc<Client>转换为Client
      let cfg = StreamableHttpClientTransportConfig::with_uri(base);
      log::debug!("[MCP/http] HTTP transport config: {:?}", cfg);

      let transport = StreamableHttpClientTransport::with_client(req, cfg);
      log::debug!("[MCP/http] HTTP transport created successfully");

      let service: McpService = match ().serve(transport).await {
        Ok(service) => {
          log::info!(
            "[MCP/http] HTTP service created successfully for server: {}",
            name
          );
          service
        }
        Err(e) => {
          log::error!("[MCP/http] Failed to create HTTP service: {}", e);
          return Err(e.to_string());
        }
      };

      state.0.insert(name.clone(), service);
      log::info!(
        "[MCP/http] HTTP connection established successfully for server: {}",
        name
      );
      Ok(())
    }
    _ => {
      let error_msg = format!("Unsupported transport type: {}", config.r#type);
      log::error!("[MCP] {}", error_msg);
      Err(error_msg)
    }
  }
}

/// 判断 host 是否为本地或私有网段（用于自动绕过代理）
fn is_local_or_private(host: &str) -> bool {
  let lower = host.to_ascii_lowercase();
  if lower == "localhost" {
    return true;
  }
  if let Ok(ip) = host.parse::<IpAddr>() {
    match ip {
      IpAddr::V4(v4) => {
        if v4.is_loopback() || v4.is_private() {
          return true;
        }
        // 额外常见内网广播/链路本地
        if v4.octets()[0] == 169 && v4.octets()[1] == 254 {
          return true;
        }
        false
      }
      IpAddr::V6(v6) => {
        // 回环或链路本地
        v6.is_loopback() || v6.is_unicast_link_local()
      }
    }
  } else {
    // 域名无法判定，视为非本地
    false
  }
}
#[tauri::command]
pub async fn mcp_disconnect(name: String, state: State<'_, McpState>) -> Result<(), String> {
  log::info!("[MCP] Disconnecting server: {}", name);

  if let Some((_, service)) = state.0.remove(&name) {
    log::debug!("[MCP] Found service, cancelling...");
    match service.cancel().await {
      Ok(_) => {
        log::info!("[MCP] Server {} disconnected successfully", name);
        Ok(())
      }
      Err(e) => {
        log::error!("[MCP] Failed to cancel service for server {}: {}", name, e);
        Err(e.to_string())
      }
    }
  } else {
    log::warn!("[MCP] Server {} not found in state", name);
    Ok(())
  }
}

#[tauri::command]
pub async fn mcp_list_tools(
  server_name: String,
  state: State<'_, McpState>,
) -> Result<Vec<Tool>, String> {
  log::debug!("[MCP] Listing tools for server: {}", server_name);

  let service = state
    .0
    .get(&server_name)
    .ok_or_else(|| "Server not found".to_string())?;
  let ListToolsResult { tools, .. } = match service.list_tools(Default::default()).await {
    Ok(result) => {
      log::debug!(
        "[MCP] Successfully listed {} tools from server {}",
        result.tools.len(),
        server_name
      );
      result
    }
    Err(e) => {
      log::error!(
        "[MCP] Failed to list tools from server {}: {}",
        server_name,
        e
      );
      return Err(e.to_string());
    }
  };

  Ok(tools)
}

#[tauri::command]
pub async fn mcp_call_tool(
  server_name: String,
  tool_name: String,
  args: Option<serde_json::Map<String, serde_json::Value>>,
  state: State<'_, McpState>,
) -> Result<serde_json::Value, String> {
  log::debug!(
    "[MCP] Calling tool {} on server {} with args: {:?}",
    tool_name,
    server_name,
    args
  );

  let service = state
    .0
    .get(&server_name)
    .ok_or_else(|| "Server not found".to_string())?;
  let param = CallToolRequestParam {
    name: tool_name.clone().into(),
    arguments: args,
  };

  let res = match service.call_tool(param).await {
    Ok(result) => {
      log::debug!(
        "[MCP] Tool {} called successfully on server {}",
        tool_name,
        server_name
      );
      result
    }
    Err(e) => {
      log::error!(
        "[MCP] Failed to call tool {} on server {}: {}",
        tool_name,
        server_name,
        e
      );
      return Err(e.to_string());
    }
  };

  match serde_json::to_value(res) {
    Ok(value) => Ok(value),
    Err(e) => {
      log::error!("[MCP] Failed to serialize tool result: {}", e);
      Err(e.to_string())
    }
  }
}

// —— Resources ——
#[tauri::command]
pub async fn mcp_list_resources(
  server_name: String,
  state: State<'_, McpState>,
) -> Result<serde_json::Value, String> {
  log::debug!("[MCP] Listing resources for server: {}", server_name);

  let service = state
    .0
    .get(&server_name)
    .ok_or_else(|| "Server not found".to_string())?;
  let res = match service.list_resources(Default::default()).await {
    Ok(result) => {
      log::debug!(
        "[MCP] Successfully listed resources from server {}",
        server_name
      );
      result
    }
    Err(e) => {
      log::error!(
        "[MCP] Failed to list resources from server {}: {}",
        server_name,
        e
      );
      return Err(e.to_string());
    }
  };

  match serde_json::to_value(res) {
    Ok(value) => Ok(value),
    Err(e) => {
      log::error!("[MCP] Failed to serialize resources result: {}", e);
      Err(e.to_string())
    }
  }
}

#[tauri::command]
pub async fn mcp_read_resource(
  server_name: String,
  uri: String,
  state: State<'_, McpState>,
) -> Result<serde_json::Value, String> {
  log::debug!(
    "[MCP] Reading resource {} from server: {}",
    uri,
    server_name
  );

  let service = state
    .0
    .get(&server_name)
    .ok_or_else(|| "Server not found".to_string())?;
  let params = ReadResourceRequestParam {
    uri: uri.clone().into(),
  };

  let res = match service.read_resource(params).await {
    Ok(result) => {
      log::debug!(
        "[MCP] Successfully read resource {} from server {}",
        uri,
        server_name
      );
      result
    }
    Err(e) => {
      log::error!(
        "[MCP] Failed to read resource {} from server {}: {}",
        uri,
        server_name,
        e
      );
      return Err(e.to_string());
    }
  };

  match serde_json::to_value(res) {
    Ok(value) => Ok(value),
    Err(e) => {
      log::error!("[MCP] Failed to serialize resource result: {}", e);
      Err(e.to_string())
    }
  }
}

// —— Prompts ——
#[tauri::command]
pub async fn mcp_list_prompts(
  server_name: String,
  state: State<'_, McpState>,
) -> Result<serde_json::Value, String> {
  log::debug!("[MCP] Listing prompts for server: {}", server_name);

  let service = state
    .0
    .get(&server_name)
    .ok_or_else(|| "Server not found".to_string())?;
  let res = match service.list_prompts(Default::default()).await {
    Ok(result) => {
      log::debug!(
        "[MCP] Successfully listed prompts from server {}",
        server_name
      );
      result
    }
    Err(e) => {
      log::error!(
        "[MCP] Failed to list prompts from server {}: {}",
        server_name,
        e
      );
      return Err(e.to_string());
    }
  };

  match serde_json::to_value(res) {
    Ok(value) => Ok(value),
    Err(e) => {
      log::error!("[MCP] Failed to serialize prompts result: {}", e);
      Err(e.to_string())
    }
  }
}

#[tauri::command]
pub async fn mcp_get_prompt(
  server_name: String,
  name: String,
  args: Option<serde_json::Map<String, serde_json::Value>>,
  state: State<'_, McpState>,
) -> Result<serde_json::Value, String> {
  log::debug!(
    "[MCP] Getting prompt {} from server: {} with args: {:?}",
    name,
    server_name,
    args
  );

  let service = state
    .0
    .get(&server_name)
    .ok_or_else(|| "Server not found".to_string())?;
  let params = GetPromptRequestParam {
    name: name.clone().into(),
    arguments: args,
  };

  let res = match service.get_prompt(params).await {
    Ok(result) => {
      log::debug!(
        "[MCP] Successfully got prompt {} from server {}",
        name,
        server_name
      );
      result
    }
    Err(e) => {
      log::error!(
        "[MCP] Failed to get prompt {} from server {}: {}",
        name,
        server_name,
        e
      );
      return Err(e.to_string());
    }
  };

  match serde_json::to_value(res) {
    Ok(value) => Ok(value),
    Err(e) => {
      log::error!("[MCP] Failed to serialize prompt result: {}", e);
      Err(e.to_string())
    }
  }
}
