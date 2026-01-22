use lazy_static::lazy_static;
use reqwest::header::{
  HeaderMap, HeaderName, HeaderValue, ACCEPT, ACCEPT_ENCODING, ACCEPT_LANGUAGE,
  UPGRADE_INSECURE_REQUESTS, USER_AGENT,
};
use reqwest::Client;
use std::sync::Arc;
use std::time::Duration;

/// HTTP客户端配置选项
#[derive(Debug, Clone)]
pub struct HttpClientConfig {
  /// 超时时间（秒）
  pub timeout_secs: u64,
  /// 是否强制使用HTTP/1.1
  pub http1_only: bool,
  /// 是否使用浏览器模拟头
  pub browser_like_headers: bool,
  /// 自定义用户代理
  pub user_agent: Option<String>,
  /// 是否启用原生TLS（而非rustls）
  pub use_native_tls: bool,
  /// 是否禁用证书验证（仅用于测试）
  pub danger_accept_invalid_certs: bool,
  /// 自定义连接超时（毫秒）
  pub connect_timeout_ms: Option<u64>,
  /// 是否启用gzip压缩
  pub gzip: bool,
  /// 是否启用brotli压缩
  pub brotli: bool,
  /// 是否禁用HTTP/2
  pub disable_http2: bool,
  /// 代理URL
  pub proxy_url: Option<String>,
}

impl Default for HttpClientConfig {
  fn default() -> Self {
    Self {
      timeout_secs: 30,
      http1_only: false,
      browser_like_headers: true,
      user_agent: None,
      use_native_tls: false,
      danger_accept_invalid_certs: false,
      connect_timeout_ms: None,
      gzip: true,
      brotli: true,
      disable_http2: false,
      proxy_url: None,
    }
  }
}

/// 全局HTTP客户端管理器
pub struct HttpClientManager {
  default_client: Arc<Client>,
  browser_like_client: Arc<Client>,
  http1_client: Arc<Client>,
  stealth_client: Arc<Client>,
  minimal_client: Arc<Client>,
}

impl HttpClientManager {
  /// 创建新的客户端管理器实例
  pub fn new() -> Result<Self, reqwest::Error> {
    let default_client = Arc::new(Self::build_default_client()?);
    let browser_like_client = Arc::new(Self::build_browser_like_client()?);
    let http1_client = Arc::new(Self::build_http1_client()?);
    let stealth_client = Arc::new(Self::build_stealth_client()?);
    let minimal_client = Arc::new(Self::build_minimal_client()?);

    Ok(Self {
      default_client,
      browser_like_client,
      http1_client,
      stealth_client,
      minimal_client,
    })
  }

  /// 获取默认客户端（最小配置）
  pub fn default_client(&self) -> Arc<Client> {
    self.default_client.clone()
  }

  /// 获取浏览器模拟客户端（推荐用于解决WAF问题）
  pub fn browser_like_client(&self) -> Arc<Client> {
    self.browser_like_client.clone()
  }

  /// 获取HTTP/1.1专用客户端
  pub fn http1_client(&self) -> Arc<Client> {
    self.http1_client.clone()
  }

  /// 获取隐秘模式客户端（最大限度反检测）
  pub fn stealth_client(&self) -> Arc<Client> {
    self.stealth_client.clone()
  }

  /// 获取最小化客户端（无多余头信息）
  pub fn minimal_client(&self) -> Arc<Client> {
    self.minimal_client.clone()
  }

  /// 根据配置创建自定义客户端
  pub fn build_custom_client(config: HttpClientConfig) -> Result<Client, reqwest::Error> {
    let mut builder = Client::builder().timeout(Duration::from_secs(config.timeout_secs));

    // 连接超时
    if let Some(connect_timeout_ms) = config.connect_timeout_ms {
      builder = builder.connect_timeout(Duration::from_millis(connect_timeout_ms));
    }

    // HTTP版本控制
    if config.http1_only || config.disable_http2 {
      builder = builder.http1_only();
    }

    // 压缩设置
    if !config.gzip {
      builder = builder.no_gzip();
    }
    if !config.brotli {
      builder = builder.no_brotli();
    }

    // TLS证书验证（仅用于测试环境）
    if config.danger_accept_invalid_certs {
      builder = builder.danger_accept_invalid_certs(true);
    }

    // 代理设置
    if let Some(proxy_url) = &config.proxy_url {
      if let Ok(proxy) = reqwest::Proxy::all(proxy_url) {
        builder = builder.proxy(proxy);
      }
    }

    // 浏览器模拟头
    if config.browser_like_headers {
      let headers = Self::build_browser_headers(config.user_agent.as_deref());
      builder = builder.default_headers(headers);
    }

    // 注意：这里需要根据Cargo.toml的配置来决定是否使用native-tls
    // 如果要在运行时切换，需要在编译时就决定使用哪个TLS后端

    builder.build()
  }

  /// 构建默认客户端（最小配置）
  fn build_default_client() -> Result<Client, reqwest::Error> {
    Client::builder().timeout(Duration::from_secs(30)).build()
  }

  /// 构建浏览器模拟客户端
  fn build_browser_like_client() -> Result<Client, reqwest::Error> {
    let headers = Self::build_browser_headers(None);

    Client::builder()
      .default_headers(headers)
      .timeout(Duration::from_secs(30))
      .build()
  }

  /// 构建HTTP/1.1专用客户端
  fn build_http1_client() -> Result<Client, reqwest::Error> {
    let headers = Self::build_browser_headers(None);

    Client::builder()
      .default_headers(headers)
      .timeout(Duration::from_secs(30))
      .http1_only()
      .build()
  }

  /// 构建隐秘模式客户端（反检测）
  fn build_stealth_client() -> Result<Client, reqwest::Error> {
    let headers = Self::build_stealth_headers();

    Client::builder()
      .default_headers(headers)
      .timeout(Duration::from_secs(60))
      .connect_timeout(Duration::from_millis(10000))
      .http1_only()
      .danger_accept_invalid_certs(false)
      .build()
  }

  /// 构建最小化客户端（无多余头信息）
  fn build_minimal_client() -> Result<Client, reqwest::Error> {
    Client::builder()
      .timeout(Duration::from_secs(120))
      .connect_timeout(Duration::from_millis(30000))
      .http1_only()
      .no_gzip()
      .no_brotli()
      .build()
  }

  /// 构建浏览器模拟请求头
  fn build_browser_headers(custom_user_agent: Option<&str>) -> HeaderMap {
    let mut headers = HeaderMap::new();

    // User-Agent - 模拟最新的Chrome
    let user_agent = custom_user_agent.unwrap_or(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );
    headers.insert(
      USER_AGENT,
      HeaderValue::from_str(user_agent).unwrap_or_else(|_| HeaderValue::from_static("Mozilla/5.0")),
    );

    // Accept headers - 模拟浏览器的接受能力
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"),
    );
    headers.insert(
      ACCEPT_LANGUAGE,
      HeaderValue::from_static("en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7"),
    );
    headers.insert(
      ACCEPT_ENCODING,
      HeaderValue::from_static("gzip, deflate, br"),
    );

    // Sec-Fetch headers - 现代浏览器的安全策略头
    headers.insert(
      HeaderName::from_static("sec-fetch-dest"),
      HeaderValue::from_static("document"),
    );
    headers.insert(
      HeaderName::from_static("sec-fetch-mode"),
      HeaderValue::from_static("navigate"),
    );
    headers.insert(
      HeaderName::from_static("sec-fetch-site"),
      HeaderValue::from_static("none"),
    );

    // Chrome特有的Client Hints
    headers.insert(
      HeaderName::from_static("sec-ch-ua"),
      HeaderValue::from_static(
        "\"Not_A Brand\";v=\"8\", \"Chromium\";v=\"120\", \"Google Chrome\";v=\"120\"",
      ),
    );
    headers.insert(
      HeaderName::from_static("sec-ch-ua-mobile"),
      HeaderValue::from_static("?0"),
    );
    headers.insert(
      HeaderName::from_static("sec-ch-ua-platform"),
      HeaderValue::from_static("\"Windows\""),
    );

    // 其他常见的浏览器头
    headers.insert(UPGRADE_INSECURE_REQUESTS, HeaderValue::from_static("1"));

    headers
  }

  /// 构建隐秘模式请求头（最大限度反检测）
  fn build_stealth_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();

    // 使用更常见的User-Agent，避免过于新的版本号
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"),
    );

    // 简化的Accept头，避免过于复杂的值
    headers.insert(
      ACCEPT,
      HeaderValue::from_static("application/json, text/plain, */*"),
    );

    // 常见的语言设置
    headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("en-US,en;q=0.9"));

    // 基本的编码支持，不包括brotli
    headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("gzip, deflate"));

    // 添加缓存控制
    headers.insert(
      HeaderName::from_static("cache-control"),
      HeaderValue::from_static("no-cache"),
    );

    // 添加pragma头
    headers.insert(
      HeaderName::from_static("pragma"),
      HeaderValue::from_static("no-cache"),
    );

    headers
  }
}

// 全局客户端管理器实例
lazy_static! {
  static ref GLOBAL_CLIENT_MANAGER: Result<HttpClientManager, reqwest::Error> =
    HttpClientManager::new();
}

/// 获取全局默认客户端
pub fn get_default_client() -> Result<Arc<Client>, String> {
  GLOBAL_CLIENT_MANAGER
    .as_ref()
    .map(|manager| manager.default_client())
    .map_err(|e| format!("Failed to get default HTTP client: {}", e))
}

/// 获取全局浏览器模拟客户端（推荐用于解决WAF问题）
pub fn get_browser_like_client() -> Result<Arc<Client>, String> {
  GLOBAL_CLIENT_MANAGER
    .as_ref()
    .map(|manager| manager.browser_like_client())
    .map_err(|e| format!("Failed to get browser-like HTTP client: {}", e))
}

/// 获取全局HTTP/1.1客户端
pub fn get_http1_client() -> Result<Arc<Client>, String> {
  GLOBAL_CLIENT_MANAGER
    .as_ref()
    .map(|manager| manager.http1_client())
    .map_err(|e| format!("Failed to get HTTP/1.1 client: {}", e))
}

/// 获取全局隐秘模式客户端（反检测）
pub fn get_stealth_client() -> Result<Arc<Client>, String> {
  GLOBAL_CLIENT_MANAGER
    .as_ref()
    .map(|manager| manager.stealth_client())
    .map_err(|e| format!("Failed to get stealth client: {}", e))
}

/// 获取全局最小化客户端
pub fn get_minimal_client() -> Result<Arc<Client>, String> {
  GLOBAL_CLIENT_MANAGER
    .as_ref()
    .map(|manager| manager.minimal_client())
    .map_err(|e| format!("Failed to get minimal client: {}", e))
}

/// 根据类型获取HTTP客户端
pub fn get_client_by_type(client_type: &str) -> Result<Arc<Client>, String> {
  match GLOBAL_CLIENT_MANAGER.as_ref() {
    Ok(manager) => match client_type {
      "default" => Ok(manager.default_client()),
      "browser_like" => Ok(manager.browser_like_client()),
      "http1_only" => Ok(manager.http1_client()),
      "stealth" => Ok(manager.stealth_client()),
      "minimal" => Ok(manager.minimal_client()),
      _ => Err(format!("Unknown client type: {}", client_type)),
    },
    Err(e) => Err(format!("Failed to initialize HTTP client manager: {}", e)),
  }
}

/// Tauri命令：获取当前HTTP客户端配置信息
#[tauri::command]
pub fn get_http_client_info() -> Result<serde_json::Value, String> {
  let info = serde_json::json!({
      "available_clients": ["default", "browser_like", "http1_only", "stealth", "minimal"],
      "client_descriptions": {
          "default": "默认配置，基本的HTTP客户端",
          "browser_like": "模拟浏览器行为，添加完整浏览器头信息",
          "http1_only": "强制使用HTTP/1.1协议",
          "stealth": "隐秘模式，最大限度反检测（推荐用于严格WAF）",
          "minimal": "最小化配置，无多余头信息，适用于简单API"
      },
      "default_config": {
          "timeout_secs": 30,
          "http1_only": false,
          "browser_like_headers": true,
          "use_native_tls": false
      },
      "tls_backend": "rustls", // 当前使用rustls，可通过修改Cargo.toml切换到native-tls
      "recommendations": {
          "connection_rejected": "尝试使用 'stealth' 或 'minimal' 客户端类型",
          "waf_blocked": "使用 'stealth' 客户端类型并考虑添加代理",
          "timeout": "增加timeout设置或使用 'minimal' 客户端"
      }
  });
  Ok(info)
}

/// Tauri命令：对比测试多种客户端（用于调试WAF问题）
#[tauri::command]
pub async fn compare_http_clients(url: String) -> Result<serde_json::Value, String> {
  let clients = vec![
    ("default", get_default_client()?),
    ("browser_like", get_browser_like_client()?),
    ("http1_only", get_http1_client()?),
    ("stealth", get_stealth_client()?),
    ("minimal", get_minimal_client()?),
  ];

  let mut results = serde_json::Map::new();

  for (client_name, client) in clients {
    let start_time = std::time::Instant::now();

    match client.get(&url).send().await {
      Ok(response) => {
        let duration = start_time.elapsed();
        let status = response.status();
        let headers: std::collections::HashMap<String, String> = response
          .headers()
          .iter()
          .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
          .collect();

        results.insert(client_name.to_string(), serde_json::json!({
                    "success": true,
                    "status": status.as_u16(),
                    "status_text": status.canonical_reason().unwrap_or(""),
                    "duration_ms": duration.as_millis(),
                    "headers_count": headers.len(),
                    "server_header": headers.get("server").cloned().unwrap_or_else(|| "unknown".to_string())
                }));
      }
      Err(e) => {
        let duration = start_time.elapsed();
        results.insert(
          client_name.to_string(),
          serde_json::json!({
              "success": false,
              "error": e.to_string(),
              "duration_ms": duration.as_millis(),
              "error_type": if e.to_string().contains("error sending request") {
                  "connection_rejected"
              } else if e.to_string().contains("timeout") {
                  "timeout"
              } else {
                  "other"
              }
          }),
        );
      }
    }
  }

  Ok(serde_json::Value::Object(results))
}

/// Tauri命令：测试HTTP客户端连接
#[tauri::command]
pub async fn test_http_client(
  url: String,
  client_type: Option<String>,
) -> Result<serde_json::Value, String> {
  let client = match client_type.as_deref().unwrap_or("browser_like") {
    "default" => get_default_client()?,
    "browser_like" => get_browser_like_client()?,
    "http1_only" => get_http1_client()?,
    _ => return Err("Invalid client type".to_string()),
  };

  let start_time = std::time::Instant::now();

  match client.get(&url).send().await {
    Ok(response) => {
      let duration = start_time.elapsed();
      let status = response.status();
      let headers: std::collections::HashMap<String, String> = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

      Ok(serde_json::json!({
          "success": true,
          "status": status.as_u16(),
          "status_text": status.canonical_reason().unwrap_or(""),
          "duration_ms": duration.as_millis(),
          "headers": headers,
          "client_type": client_type.unwrap_or_else(|| "browser_like".to_string())
      }))
    }
    Err(e) => {
      let duration = start_time.elapsed();
      Ok(serde_json::json!({
          "success": false,
          "error": e.to_string(),
          "duration_ms": duration.as_millis(),
          "client_type": client_type.unwrap_or_else(|| "browser_like".to_string())
      }))
    }
  }
}
