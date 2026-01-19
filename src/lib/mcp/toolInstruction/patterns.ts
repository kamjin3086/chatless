/**
 * 工具指令模式定义
 * 
 * ## 设计目标
 * 
 * 集中定义所有工具调用指令的匹配模式，供检测、过滤、解析等功能统一使用。
 * 消除分散在多个文件中的重复正则表达式，确保一致性和可维护性。
 * 
 * ## 支持的指令格式
 * 
 * 1. **XML 格式**
 *    - `<use_mcp_tool>...<server_name>...</server_name>...<tool_name>...</tool_name>...</use_mcp_tool>`
 *    - `<tool_call>{ "server": "...", "tool": "..." }</tool_call>`
 * 
 * 2. **JSON 格式**
 *    - `{ "type": "tool_call", "server": "...", "tool": "..." }`
 * 
 * 3. **GPT-OSS / 函数式格式**
 *    - `<|channel|>commentary to=server.tool <|message|>{...}`
 *    - `commentary to=server.tool json {...}`
 *    - `to=server.tool {...}`
 *    - `server.tool {...}`
 * 
 * 4. **分隔符格式**
 *    - `to=>>server>>tool>>{...}>>`
 */

/**
 * 工具指令类型
 */
export type ToolInstructionFormat = 
  | 'xml_use_mcp_tool'
  | 'xml_tool_call'
  | 'json_tool_call'
  | 'gpt_oss'
  | 'gpt_oss_tags'
  | 'gpt_oss_tool_call'
  | 'gpt_oss_analysis'
  | 'commentary'
  | 'to_equals'
  | 'function_like'
  | 'separator_style'
  | 'internal_marker';

/**
 * 模式定义接口
 */
export interface PatternDefinition {
  /** 模式唯一标识 */
  id: ToolInstructionFormat;
  /** 完整匹配正则（用于替换/移除） */
  completePattern: RegExp;
  /** 起始检测正则（用于流式抑制触发） */
  startPattern?: RegExp;
  /** 未完成片段正则（用于清理尾部残片） */
  incompletePattern?: RegExp;
  /** 优先级（数字越小优先级越高） */
  priority: number;
  /** 描述 */
  description: string;
}

/**
 * 所有工具指令模式定义
 */
export const TOOL_INSTRUCTION_PATTERNS: PatternDefinition[] = [
  // 1. XML 格式 - 最高优先级
  {
    id: 'xml_use_mcp_tool',
    completePattern: /<use_mcp_tool>[\s\S]*?<\/use_mcp_tool>/gi,
    startPattern: /<use_mcp_tool>/i,
    incompletePattern: /<use_mcp_tool>[\s\S]*$/i,
    priority: 1,
    description: 'MCP 标准 XML 格式：<use_mcp_tool>...</use_mcp_tool>'
  },
  {
    id: 'xml_tool_call',
    completePattern: /<tool_call>[\s\S]*?<\/tool_call>/gi,
    startPattern: /<tool_call>/i,
    incompletePattern: /<tool_call>[\s\S]*$/i,
    priority: 2,
    description: '通用 XML 格式：<tool_call>...</tool_call>'
  },
  
  // 2. GPT-OSS 模板标签（需要剥离的内部结构标记）
  // 常见标签: <|channel|>, <|message|>, <|end|>, <|thinking|>, <|constrain|> 等
  {
    id: 'gpt_oss_tags',
    // 匹配独立的模板标签（不含其他内容时）
    completePattern: /<\|(?:channel|message|end|thinking|constrain|tool_calls?|function_calls?|assistant|user|system)\|>/gi,
    priority: 2,
    description: 'GPT-OSS 模板标签：<|channel|>, <|message|>, <|end|> 等'
  },
  
  // 3. GPT-OSS 完整工具调用格式
  {
    id: 'gpt_oss_tool_call',
    // 匹配: <|channel|>commentary to=xxx ... <|message|>{...} 或 <|channel|>commentary to=xxx ... {json}
    completePattern: /<\|channel\|>\s*commentary\s+to=[^\s]+[\s\S]*?(?:<\|message\|>)?\s*\{[\s\S]*?\}(?:\s*<\|end\|>)?/gi,
    startPattern: /<\|channel\|>\s*commentary\s+to=/i,
    priority: 3,
    description: 'GPT-OSS 工具调用格式：<|channel|>commentary to=... {json}'
  },
  
  // 4. GPT-OSS analysis/thinking 块
  {
    id: 'gpt_oss_analysis',
    // 匹配: <|channel|>analysis ... <|channel|>final 或类似结构
    completePattern: /<\|channel\|>\s*analysis[\s\S]*?<\|channel\|>\s*(?:final|response)/gi,
    priority: 4,
    description: 'GPT-OSS analysis/thinking 块'
  },
  
  // 5. Commentary 格式（无特殊标签）
  {
    id: 'commentary',
    completePattern: /commentary\s+to=[^\n]+?\s+json\s*\{[\s\S]*?\}/gi,
    startPattern: /commentary\s+to=[^\n{]{1,200}\{/i,
    priority: 5,
    description: 'Commentary 格式：commentary to=... json {...}'
  },
  
  // 6. to= 格式
  // ⚠️ 移除 incompletePattern，避免误删 Markdown 链接中的文本
  {
    id: 'to_equals',
    completePattern: /(?:^|\s)to\s*=\s*[a-z0-9_.-]+\s*\{[\s\S]*?\}/gi,
    startPattern: /(?:^|\s)to\s*=\s*[a-z0-9_.-]+\s*\{/i,
    // incompletePattern 已移除，避免误删
    priority: 6,
    description: 'to= 格式：to=server.tool {...}'
  },
  
  // 7. 函数式格式
  // ⚠️ 移除 incompletePattern，避免误删如 "Socket.io" 这样的文本
  {
    id: 'function_like',
    completePattern: /(^|\s)[a-z0-9_]+\.[a-z0-9_]+\s*\{[\s\S]*?\}/gi,
    startPattern: /(?:^|\s)[a-z0-9_]+\.[a-z0-9_]+\s*\{/i,
    // incompletePattern 已移除，避免误删
    priority: 7,
    description: '函数式格式：server.tool {...}'
  },
  
  // 8. 分隔符格式
  {
    id: 'separator_style',
    completePattern: /to\s*=\s*>+[a-z0-9_-]+>+[a-z0-9_-]+>+\s*{[\s\S]*?}>+/gi,
    priority: 8,
    description: '分隔符格式：to=>>server>>tool>>{...}>>'
  },
  
  // 9. JSON 格式
  // ⚠️ 已禁用简单正则匹配，因为无法正确处理嵌套 JSON
  // 使用专门的 JSON 清理函数替代（见 filter.ts 中的 cleanJsonToolCalls）
  // {
  //   id: 'json_tool_call',
  //   completePattern: /\{[\s\S]*?"type"\s*:\s*"tool_call"[\s\S]*?\}/gi,
  //   priority: 9,
  //   description: 'JSON 格式：{ "type": "tool_call", ... }'
  // },
  
  // 10. 内部标记
  {
    id: 'internal_marker',
    completePattern: /\{[^}]*"__tool_call_card__"[^}]*\}/g,
    priority: 10,
    description: '内部工具卡片标记'
  }
];

/**
 * 不完整标签前缀列表
 * 用于清理流式输出中的半截标签
 * 
 * ⚠️ 重要：只包含 MCP 工具调用相关的标签，避免误删 HTML 标签
 */
export const INCOMPLETE_TAG_PREFIXES = [
  // MCP XML 格式
  '<use_mcp_tool', '<tool_call',
  '</use_mcp_tool', '</tool_call',
  // GPT-OSS 模板标签（使用 <| 开头，可以安全匹配）
  '<|channel|', '<|message|', '<|end|', '<|thinking|',
  '<|constrain|', '<|tool_call', '<|function_call'
];

/**
 * 最小不完整前缀长度
 * 
 * ⚠️ 重要：设置为较高值以避免误删
 * - 设为 4 可以安全匹配 <| 开头的 GPT-OSS 标签
 * - MCP 标签足够长，不会与 HTML 混淆
 */
export const MIN_INCOMPLETE_PREFIX_LENGTH = 4;

/**
 * 抑制器触发模式
 * 用于 ToolInstructionSuppressor 判断进入抑制状态
 */
export type SuppressionMode = 'xml_use_mcp_tool' | 'xml_tool_call' | 'json_like';

export interface SuppressionTrigger {
  pattern: RegExp;
  mode: SuppressionMode;
}

/**
 * 获取抑制触发器列表
 */
export function getSuppressionTriggers(): SuppressionTrigger[] {
  return [
    { pattern: /<use_mcp_tool>/i, mode: 'xml_use_mcp_tool' },
    { pattern: /<tool_call>/i, mode: 'xml_tool_call' },
    { pattern: /<\|channel\|>\s*commentary\s+to=[^\n{]{1,200}\{/i, mode: 'json_like' },
    { pattern: /commentary\s+to=[^\n{]{1,200}\{/i, mode: 'json_like' },
    // 新增：反向格式 json{...}commentary to=...
    { pattern: /json\s*\{[^}]*\}\s*commentary\s+to=/i, mode: 'json_like' },
    { pattern: /(?:^|\s)to\s*=\s*[a-z0-9_.-]+\s*\{/i, mode: 'json_like' },
    { pattern: /(?:^|\s)[a-z0-9_]+\.[a-z0-9_]+\s*\{/i, mode: 'json_like' },
  ];
}

/**
 * 快速检测文本是否可能包含工具指令或模板标签
 * 用于快速路径优化，避免不必要的正则匹配
 * 
 * ⚠️ 重要：这个函数决定了是否进入过滤流程
 * 必须足够精确，避免对正常 HTML/Markdown 内容触发过滤
 */
export function mightContainToolInstruction(text: string): boolean {
  if (!text) return false;
  
  // 只检测明确的 MCP 工具调用特征，而非通用的 "<" 或 "{"
  const lowerText = text.toLowerCase();
  
  return (
    // MCP XML 格式
    lowerText.includes('<use_mcp_tool') ||
    lowerText.includes('<tool_call') ||
    lowerText.includes('</use_mcp_tool') ||
    lowerText.includes('</tool_call') ||
    // 内部标记
    text.includes('__tool_call_card__') ||
    // GPT-OSS 模板标签（需要剥离的内部结构标记）
    // 使用 <| 作为快速检测，而不是完整的 <|channel|>
    text.includes('<|') ||
    lowerText.includes('commentary to=') ||
    // 新增：反向格式 json{...}commentary to=...
    (lowerText.includes('json') && lowerText.includes('commentary')) ||
    // JSON 格式的工具调用（更严格的检测）
    /"type"\s*:\s*"tool_call"/i.test(text)
  );
}

