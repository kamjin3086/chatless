use serde::{Deserialize, Serialize};

// 前端传入的服务器配置（简化版）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
  pub r#type: String,                         // stdio | sse | http
  pub command: Option<String>,                // stdio 用
  pub args: Option<Vec<String>>,              // stdio 用
  pub env: Option<Vec<(String, String)>>,     // stdio 用（键值对）
  pub base_url: Option<String>,               // sse/http 用
  pub headers: Option<Vec<(String, String)>>, // sse/http 用
  /// 是否对该 MCP 连接启用自定义代理（前端可选传入；未传或为 false 则不启用）
  pub use_proxy: Option<bool>, // sse/http 用（可选）
  /// 自定义代理地址（形如 http://127.0.0.1:7890），与 use_proxy 配合使用
  pub proxy_url: Option<String>, // sse/http 用（可选）
}
