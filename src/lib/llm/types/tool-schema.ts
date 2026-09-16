/**
 * 工具调用 Schema 类型定义
 * 
 * ## 设计目标
 * 
 * 定义统一的工具调用接口，支持 OpenAI 和 Anthropic 的原生工具调用 API。
 * 
 * ## 支持的格式
 * 
 * 1. OpenAI Tools API:
 *    - tools: Tool[]
 *    - tool_choice: 'auto' | 'none' | { type: 'function', function: { name: string } }
 * 
 * 2. Anthropic Tools API:
 *    - tools: Tool[]
 *    - tool_choice: { type: 'auto' | 'any' | 'tool', name?: string }
 */

/**
 * JSON Schema 类型定义
 */
export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';
  description?: string;
  enum?: (string | number | boolean | null)[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  default?: unknown;
}

export interface JsonSchema {
  type: 'object';
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * 工具定义（通用格式）
 */
export interface ToolDefinition {
  /** 工具名称（唯一标识） */
  name: string;
  /** 工具描述 */
  description: string;
  /** 参数 Schema */
  parameters?: JsonSchema;
}

/**
 * OpenAI 格式的工具定义
 */
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters?: JsonSchema;
  };
}

/**
 * OpenAI 工具选择
 */
export type OpenAIToolChoice = 
  | 'auto' 
  | 'none' 
  | 'required'
  | { type: 'function'; function: { name: string } };

/**
 * Anthropic 格式的工具定义
 */
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

/**
 * Anthropic 工具选择
 */
export type AnthropicToolChoice = 
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'tool'; name: string };

/**
 * 工具调用请求（响应中的）
 */
export interface ToolCallRequest {
  /** 调用 ID */
  id: string;
  /** 调用类型 */
  type: 'function';
  /** 函数信息 */
  function: {
    name: string;
    arguments: string;
  };
  /** Provider-specific opaque data that must round-trip across tool turns. */
  providerData?: unknown;
}

/**
 * 工具调用结果
 */
export interface ToolCallResult {
  /** 对应的调用 ID */
  tool_call_id: string;
  /** 工具输出（字符串格式） */
  output: string;
  /** 是否出错 */
  is_error?: boolean;
}

/**
 * 工具调用选项（传递给 Provider 的选项）
 */
export interface ToolCallOptions {
  /** 工具定义列表 */
  tools?: ToolDefinition[];
  /** 工具选择策略 */
  toolChoice?: 'auto' | 'none' | 'required' | { name: string };
  /** 是否并行调用多个工具 */
  parallelToolCalls?: boolean;
}

/**
 * 将通用工具定义转换为 OpenAI 格式
 */
export function toOpenAITools(tools: ToolDefinition[]): OpenAITool[] {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * 将通用工具选择转换为 OpenAI 格式
 */
export function toOpenAIToolChoice(
  choice?: 'auto' | 'none' | 'required' | { name: string }
): OpenAIToolChoice | undefined {
  if (!choice) return undefined;
  if (typeof choice === 'string') return choice;
  return { type: 'function', function: { name: choice.name } };
}

/**
 * 将通用工具定义转换为 Anthropic 格式
 */
export function toAnthropicTools(tools: ToolDefinition[]): AnthropicTool[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters || { type: 'object' },
  }));
}

/**
 * 将通用工具选择转换为 Anthropic 格式
 */
export function toAnthropicToolChoice(
  choice?: 'auto' | 'none' | 'required' | { name: string }
): AnthropicToolChoice | undefined {
  if (!choice) return undefined;
  if (choice === 'auto' || choice === 'none') return { type: 'auto' };
  if (choice === 'required') return { type: 'any' };
  return { type: 'tool', name: choice.name };
}

/**
 * 解析工具调用参数
 * 
 * 使用增量 JSON 解析器处理可能不完整的参数
 */
export function parseToolArguments(argsString: string): Record<string, unknown> {
  if (!argsString || argsString.trim() === '') {
    return {};
  }
  
  try {
    return JSON.parse(argsString);
  } catch {
    // 使用增量解析器
    try {
      const { parsePartialJson } = require('@/lib/utils/partialJsonParser');
      const result = parsePartialJson(argsString) as Record<string, unknown> | null;
      return result || {};
    } catch {
      return {};
    }
  }
}

