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
  
  // 2. GPT-OSS 格式
  {
    id: 'gpt_oss',
    completePattern: /<\|channel\|>\s*commentary\s+to=[^\s]+[\s\S]*?<\|message\|>\s*\{[\s\S]*?\}/gi,
    startPattern: /<\|channel\|>\s*commentary\s+to=[^\n{]{1,200}\{/i,
    priority: 3,
    description: 'GPT-OSS 格式：<|channel|>commentary to=... <|message|>{...}'
  },
  
  // 3. Commentary 格式（无特殊标签）
  {
    id: 'commentary',
    completePattern: /commentary\s+to=[^\n]+?\s+json\s*\{[\s\S]*?\}/gi,
    startPattern: /commentary\s+to=[^\n{]{1,200}\{/i,
    priority: 4,
    description: 'Commentary 格式：commentary to=... json {...}'
  },
  
  // 4. to= 格式
  {
    id: 'to_equals',
    completePattern: /(?:^|\s)to\s*=\s*[a-z0-9_.-]+\s*\{[\s\S]*?\}/gi,
    startPattern: /(?:^|\s)to\s*=\s*[a-z0-9_.-]+\s*\{/i,
    incompletePattern: /(?:^|\s)to\s*=\s*[a-z0-9_.-]+\s*\{?$/i,
    priority: 5,
    description: 'to= 格式：to=server.tool {...}'
  },
  
  // 5. 函数式格式
  {
    id: 'function_like',
    completePattern: /(^|\s)[a-z0-9_]+\.[a-z0-9_]+\s*\{[\s\S]*?\}/gi,
    startPattern: /(?:^|\s)[a-z0-9_]+\.[a-z0-9_]+\s*\{/i,
    incompletePattern: /(?:^|\s)[a-z0-9_]+\.[a-z0-9_]+\s*\{?$/i,
    priority: 6,
    description: '函数式格式：server.tool {...}'
  },
  
  // 6. 分隔符格式
  {
    id: 'separator_style',
    completePattern: /to\s*=\s*>+[a-z0-9_-]+>+[a-z0-9_-]+>+\s*{[\s\S]*?}>+/gi,
    priority: 7,
    description: '分隔符格式：to=>>server>>tool>>{...}>>'
  },
  
  // 7. JSON 格式
  {
    id: 'json_tool_call',
    completePattern: /\{[\s\S]*?"type"\s*:\s*"tool_call"[\s\S]*?\}/gi,
    priority: 8,
    description: 'JSON 格式：{ "type": "tool_call", ... }'
  },
  
  // 8. 内部标记
  {
    id: 'internal_marker',
    completePattern: /\{[^}]*"__tool_call_card__"[^}]*\}/g,
    priority: 9,
    description: '内部工具卡片标记'
  }
];

/**
 * 不完整标签前缀列表
 * 用于清理流式输出中的半截标签
 */
export const INCOMPLETE_TAG_PREFIXES = [
  '<use_mcp_tool', '<tool_call', '</use_mcp_tool', '</tool_call',
  '<server_name', '</server_name', '<tool_name', '</tool_name',
  '<arguments', '</arguments'
];

/**
 * 最小不完整前缀长度
 * 避免误删单字符 "<"
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
    { pattern: /(?:^|\s)to\s*=\s*[a-z0-9_.-]+\s*\{/i, mode: 'json_like' },
    { pattern: /(?:^|\s)[a-z0-9_]+\.[a-z0-9_]+\s*\{/i, mode: 'json_like' },
  ];
}

/**
 * 快速检测文本是否可能包含工具指令
 * 用于快速路径优化，避免不必要的正则匹配
 */
export function mightContainToolInstruction(text: string): boolean {
  if (!text) return false;
  
  return (
    text.includes('<') ||
    text.includes('{') ||
    /commentary\s+to=/i.test(text) ||
    /(?:^|\s)to\s*=/i.test(text)
  );
}

