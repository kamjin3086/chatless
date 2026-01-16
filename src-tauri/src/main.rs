// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod env_setup;

fn main() {
  // 设置环境变量
  if let Err(e) = env_setup::setup_environment() {
    eprintln!("Failed to setup environment: {}", e);
    // 继续运行，但记录错误
  }

  // ── Logging: 配置日志过滤，减少启动时的噪音 ────────────────
  // Unless the user explicitly overrides RUST_LOG, we apply a default
  // filter that keeps normal info logs but silences verbose outputs.
  // - sqlx::query=off: 关闭 SQL 查询日志
  // - sqlx=warn: 只显示 sqlx 的警告和错误（减少慢查询 info 日志）
  // - tracing::span=off: 关闭 span 追踪日志
  // - rmcp=warn: MCP SDK 只显示警告（减少连接细节日志）
  const DEFAULT_FILTER: &str = "info,sqlx::query=off,sqlx=warn,tracing::span=off,rmcp=warn";
  if std::env::var("RUST_LOG").is_err() {
    // Only set if user hasn't provided their own filter.
    std::env::set_var("RUST_LOG", DEFAULT_FILTER);
  }

  chatless_lib::run()
}
