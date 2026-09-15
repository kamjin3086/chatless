export const LIST_TOOLS_TTL_MS = 60_000; // 1min 缓存，降低重复 listTools 开销
export const LIST_TOOLS_TIMEOUT_MS = 5_000; // 单次 listTools 超时，从1.2秒增加到5秒，保障连接稳定性

// MCP 连接超时配置
// - 首次启动时使用较短超时，避免阻塞应用启动
// - 用户手动连接或工具调用时使用较长超时，保障稳定性
export const MCP_STARTUP_CONNECT_TIMEOUT_MS = 8_000; // 启动时连接超时：8秒，避免长时间阻塞
export const MCP_CONNECT_TIMEOUT_MS = 20_000; // 非 stdio（SSE/HTTP）连接超时
// stdio 刷新可能需要修复 runner + 预下载包，与后端 prefetch 上限对齐
export const MCP_STDIO_CONNECT_TIMEOUT_MS = 420_000;
export const MCP_INIT_TIMEOUT_MS = 10_000; // MCP初始化超时时间（包括连接和工具列表获取）
export const MAX_TOOL_SIGNATURES = 6;
export const MAX_TOOL_SUMMARY_PER_SERVER = 8;
// 默认递归深度（可被设置页覆盖）
export const DEFAULT_MAX_TOOL_RECURSION_DEPTH = 6;
// 兼容旧常量名（仍导出，但不再直接使用硬编码）
export const MAX_TOOL_RECURSION_DEPTH = DEFAULT_MAX_TOOL_RECURSION_DEPTH;
export const CALL_TOOL_TIMEOUT_MS = 30_000; // 单次工具调用超时
