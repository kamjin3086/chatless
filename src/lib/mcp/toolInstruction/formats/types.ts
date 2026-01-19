/**
 * 工具调用格式处理器类型定义
 * 
 * ## 设计目标
 * 
 * 定义统一的接口，使各格式处理器可以以责任链方式协作。
 * 支持检测、解析、清理三个阶段的处理。
 */

/**
 * 解析出的工具调用信息
 */
export interface ParsedToolCall {
  /** 服务器名称 */
  server: string;
  /** 工具名称 */
  tool: string;
  /** 工具参数 */
  args?: Record<string, unknown>;
  /** 原始匹配文本 */
  rawText: string;
  /** 匹配起始位置 */
  startIndex: number;
  /** 匹配结束位置 */
  endIndex: number;
  /** 格式类型 */
  format: ToolCallFormat;
  /** 置信度 (0-1)，用于多格式匹配时的优先级判断 */
  confidence: number;
}

/**
 * 处理结果
 */
export interface ProcessResult {
  /** 处理后的文本 */
  text: string;
  /** 解析出的工具调用列表 */
  toolCalls: ParsedToolCall[];
  /** 是否有处理发生 */
  processed: boolean;
  /** 移除的残片/标签 */
  removedFragments?: string[];
}

/**
 * 格式处理器接口
 * 
 * 每个格式处理器负责一种特定格式的检测、解析和清理
 */
export interface FormatHandler {
  /** 格式标识符 */
  readonly id: ToolCallFormat;
  
  /** 格式描述 */
  readonly description: string;
  
  /** 优先级（数字越小越先执行） */
  readonly priority: number;
  
  /**
   * 快速检测文本是否可能包含此格式
   * 应该尽可能快，用于快速路径优化
   */
  mightContain(text: string): boolean;
  
  /**
   * 解析文本中的工具调用
   * 返回所有匹配的工具调用信息
   */
  parse(text: string): ParsedToolCall[];
  
  /**
   * 清理文本中的工具调用指令
   * 返回清理后的文本和相关信息
   */
  clean(text: string, options?: CleanOptions): ProcessResult;
  
  /**
   * 清理不完整的片段（用于流式场景）
   */
  cleanIncomplete?(text: string): string;
}

/**
 * 清理选项
 */
export interface CleanOptions {
  /** 模式：display=UI显示，persist=持久化存储 */
  mode?: 'display' | 'persist';
  /** 是否保留换行 */
  preserveNewlines?: boolean;
  /** 是否返回解析结果 */
  parseToolCalls?: boolean;
}

/**
 * 支持的工具调用格式
 * 
 * 按优先级和使用频率排序：
 * 1. OpenAI 标准格式（最常见）
 * 2. XML 格式（MCP 标准）
 * 3. GPT-OSS 格式（本地模型常用）
 * 4. 其他格式
 */
export type ToolCallFormat = 
  // OpenAI 标准格式
  | 'openai_function_call'
  | 'openai_tool_calls'
  // XML 格式
  | 'xml_use_mcp_tool'
  | 'xml_tool_call'
  | 'xml_function'
  // GPT-OSS / Harmony 格式
  | 'gpt_oss_channel'
  | 'gpt_oss_commentary'
  | 'gpt_oss_tags'
  // 简化格式
  | 'json_tool_call'
  | 'commentary_simple'
  | 'function_like'
  // 其他/内部
  | 'internal_marker'
  | 'unknown';

/**
 * 格式元数据
 */
export interface FormatMetadata {
  id: ToolCallFormat;
  name: string;
  description: string;
  priority: number;
  /** 是否为主流格式（优先支持） */
  mainstream: boolean;
  /** 示例 */
  examples: string[];
}

/**
 * 所有格式的元数据注册表
 */
export const FORMAT_REGISTRY: FormatMetadata[] = [
  // OpenAI 标准格式
  {
    id: 'openai_function_call',
    name: 'OpenAI Function Call',
    description: 'OpenAI 标准函数调用格式，使用 function_call 字段',
    priority: 1,
    mainstream: true,
    examples: [
      '{"function_call": {"name": "get_weather", "arguments": "{\\"location\\": \\"Beijing\\"}"}}',
    ]
  },
  {
    id: 'openai_tool_calls',
    name: 'OpenAI Tool Calls',
    description: 'OpenAI 工具调用数组格式，使用 tool_calls 字段',
    priority: 2,
    mainstream: true,
    examples: [
      '{"tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "search", "arguments": "{}"}}]}',
    ]
  },
  // XML 格式
  {
    id: 'xml_use_mcp_tool',
    name: 'MCP XML Format',
    description: 'MCP 标准 XML 格式，使用 <use_mcp_tool> 标签',
    priority: 3,
    mainstream: true,
    examples: [
      '<use_mcp_tool><server_name>web_search</server_name><tool_name>search</tool_name><arguments>{"query": "test"}</arguments></use_mcp_tool>',
    ]
  },
  {
    id: 'xml_tool_call',
    name: 'Generic XML Tool Call',
    description: '通用 XML 工具调用格式',
    priority: 4,
    mainstream: true,
    examples: [
      '<tool_call>{"server": "fs", "tool": "read", "args": {}}</tool_call>',
    ]
  },
  {
    id: 'xml_function',
    name: 'XML Function Format',
    description: 'XML 函数调用格式，使用 <function> 标签',
    priority: 5,
    mainstream: false,
    examples: [
      '<function=get_weather>{"location": "Beijing"}</function>',
    ]
  },
  // GPT-OSS 格式
  {
    id: 'gpt_oss_channel',
    name: 'GPT-OSS Channel Format',
    description: 'GPT-OSS 通道格式，使用 <|channel|> 等标签',
    priority: 6,
    mainstream: true,
    examples: [
      '<|channel|>commentary to=web_search.search<|message|>{"query": "test"}<|end|>',
      '<|start|>assistant<|channel|>commentary to=functions.get_weather<|constrain|>json<|message|>{"location": "Beijing"}<|call|>',
    ]
  },
  {
    id: 'gpt_oss_commentary',
    name: 'GPT-OSS Commentary Format',
    description: 'GPT-OSS commentary 格式（无通道标签）',
    priority: 7,
    mainstream: true,
    examples: [
      'commentary to=web_search.search json {"query": "test"}',
    ]
  },
  {
    id: 'gpt_oss_tags',
    name: 'GPT-OSS Template Tags',
    description: 'GPT-OSS 模板标签（需要清理）',
    priority: 8,
    mainstream: true,
    examples: [
      '<|channel|>', '<|message|>', '<|end|>', '<|thinking|>',
    ]
  },
  // 简化格式
  {
    id: 'json_tool_call',
    name: 'JSON Tool Call',
    description: 'JSON 格式的工具调用',
    priority: 9,
    mainstream: true,
    examples: [
      '{"type": "tool_call", "server": "web_search", "tool": "search", "args": {"query": "test"}}',
    ]
  },
  {
    id: 'commentary_simple',
    name: 'Simple Commentary',
    description: '简化的 commentary 格式',
    priority: 10,
    mainstream: false,
    examples: [
      'to=web_search.search {"query": "test"}',
    ]
  },
  {
    id: 'function_like',
    name: 'Function-like Format',
    description: '类函数调用格式',
    priority: 11,
    mainstream: false,
    examples: [
      'web_search.search {"query": "test"}',
    ]
  },
  // 内部格式
  {
    id: 'internal_marker',
    name: 'Internal Marker',
    description: '内部工具卡片标记',
    priority: 100,
    mainstream: false,
    examples: [
      '{"__tool_call_card__": true, "server": "web_search", "tool": "search"}',
    ]
  },
];

