/**
 * 工具指令过滤器
 * 
 * ## 设计目标
 * 
 * 提供统一的工具指令过滤功能，确保用户界面不显示原始工具调用指令。
 * 
 * ## 使用场景
 * 
 * - **display**: 用于 UI 显示，实时过滤流式输出
 * - **persist**: 用于持久化存储，清理完整消息
 * 
 * ## 设计原则
 * 
 * 1. **单一职责**: 只负责过滤/清理，不负责解析
 * 2. **模式统一**: 使用 patterns.ts 中定义的模式
 * 3. **保留格式**: 不修改 markdown 格式、换行符等
 */

import { 
  TOOL_INSTRUCTION_PATTERNS, 
  INCOMPLETE_TAG_PREFIXES, 
  MIN_INCOMPLETE_PREFIX_LENGTH,
  mightContainToolInstruction
} from './patterns';

export type FilterMode = 'display' | 'persist';

export interface FilterOptions {
  /** 过滤模式 */
  mode: FilterMode;
  /** 是否保留换行（默认 true） */
  preserveNewlines?: boolean;
}

/**
 * 统一的工具指令过滤函数
 * 
 * @param text 要过滤的文本
 * @param options 过滤选项
 * @returns 过滤后的文本
 */
export function filterToolInstructions(
  text: string, 
  options: FilterOptions = { mode: 'display' }
): string {
  if (!text) return '';
  
  // 快速路径：如果不包含任何工具指令特征，直接返回
  if (!mightContainToolInstruction(text)) {
    return text;
  }
  
  let result = text;
  const { mode, preserveNewlines = true } = options;
  
  // 1. 应用所有完整模式进行过滤
  for (const pattern of TOOL_INSTRUCTION_PATTERNS) {
    result = result.replace(pattern.completePattern, '');
  }
  
  // 2. 对于 display 模式，额外清理未完成的片段
  if (mode === 'display') {
    result = cleanIncompleteInstructions(result);
  }
  
  // 3. 对于 persist 模式，额外清理 GPT-OSS 变体的半截指令
  if (mode === 'persist') {
    result = cleanGptOssVariants(result);
  }
  
  // 4. 清理多余空行（但保留 markdown 格式）
  if (!preserveNewlines) {
    result = result.replace(/\n\n\n+/g, '\n\n');
  }
  
  return result.trim();
}

/**
 * 清理未完成的指令片段（流式输出场景）
 * 
 * ⚠️ 重要：只清理明确的 MCP 工具调用指令，不要误删 HTML 内容
 */
function cleanIncompleteInstructions(text: string): string {
  if (!text) return '';
  
  let result = text;
  
  // 1. 只移除未完成的 MCP 工具调用 XML 指令块（use_mcp_tool 和 tool_call）
  // 不处理其他 XML 格式，避免误删 HTML
  for (const pattern of TOOL_INSTRUCTION_PATTERNS) {
    // 只处理 MCP 相关的 XML 格式
    if (pattern.incompletePattern && 
        (pattern.id === 'xml_use_mcp_tool' || pattern.id === 'xml_tool_call')) {
      result = result.replace(pattern.incompletePattern, '');
    }
  }
  
  // 2. 清理不完整的 MCP 标签前缀（只处理明确的 MCP 标签）
  // 使用更严格的匹配，确保是 MCP 工具调用标签而非普通 HTML
  for (const tag of INCOMPLETE_TAG_PREFIXES) {
    // 只有当前缀长度足够长（>= MIN_INCOMPLETE_PREFIX_LENGTH）时才处理
    // 这样可以避免误删 <strong, <script 等 HTML 标签
    for (let len = tag.length; len >= MIN_INCOMPLETE_PREFIX_LENGTH; len--) {
      const prefix = tag.substring(0, len);
      if (result.endsWith(prefix)) {
        result = result.slice(0, -prefix.length);
        break;
      }
    }
  }
  
  return result;
}

/**
 * 清理 GPT-OSS 变体的半截指令
 * 
 * ⚠️ 重要：只在 persist 模式下使用，且只处理明确的 GPT-OSS 格式
 * 不要使用过于激进的正则，避免误删正常内容
 */
function cleanGptOssVariants(text: string): string {
  if (!text) return '';
  
  let result = text;
  
  // 只处理明确包含 GPT-OSS 特征标签的内容
  // 缺少 JSON 体的半截 GPT-OSS 指令（必须以 <|channel|> 开头）
  result = result.replace(
    /<\|channel\|>\s*commentary\s+to=[^\s]+[\s\S]*?(?:<\|message\|>)?\s*$/gi,
    ''
  );
  
  // 无标签 GPT-OSS 变体（必须包含完整的 "commentary to=... json {...}" 结构）
  result = result.replace(/commentary\s+to=[^\n]+?\s+json\s*\{[\s\S]*?\}/gi, '');
  
  // ⚠️ 移除以下激进的过滤规则，它们会误删正常内容：
  // - "to=server.tool" 可能匹配 URL 参数
  // - "server.tool" 可能匹配如 "Socket.io" 这样的库名
  
  return result;
}

/**
 * 用于 UI 显示的快速过滤
 * 等价于 filterToolInstructions(text, { mode: 'display' })
 */
export function filterForDisplay(text: string): string {
  return filterToolInstructions(text, { mode: 'display' });
}

/**
 * 用于持久化存储的清理
 * 等价于 filterToolInstructions(text, { mode: 'persist' })
 */
export function filterForPersist(text: string): string {
  return filterToolInstructions(text, { mode: 'persist' });
}

