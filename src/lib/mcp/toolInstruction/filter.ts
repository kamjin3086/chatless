/**
 * 工具指令过滤器
 * 
 * ## 设计目标
 * 
 * 提供统一的工具指令过滤功能，确保用户界面不显示原始工具调用指令。
 * 
 * ## 重构说明
 * 
 * 现在委托给 formats/pipeline 进行统一的格式处理，
 * 同时保留部分特殊处理逻辑（如不完整片段清理）。
 * 
 * ## 使用场景
 * 
 * - **display**: 用于 UI 显示，实时过滤流式输出
 * - **persist**: 用于持久化存储，清理完整消息
 * 
 * ## 设计原则
 * 
 * 1. **单一职责**: 只负责过滤/清理，不负责解析
 * 2. **模式统一**: 使用 Pipeline 架构统一处理
 * 3. **保留格式**: 不修改 markdown 格式、换行符等
 */

import { 
  INCOMPLETE_TAG_PREFIXES, 
  MIN_INCOMPLETE_PREFIX_LENGTH,
} from './patterns';
import { getDefaultPipeline } from './formats';
import { ToolCallDetector } from '../ToolCallDetector';
import { containsTemplateTokens, stripTemplateTokens } from '@/lib/llm/chatTemplateTokens';

// 不完整标签的正则模式（用于流式清理）
const INCOMPLETE_XML_PATTERNS = {
  xml_use_mcp_tool: /<use_mcp_tool>[\s\S]*$/i,
  xml_tool_call: /<tool_call>[\s\S]*$/i,
};

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

  // Chat-template control tokens (``<|im_end|>``, ``<|im_start|>user``, ...) are
  // never part of an answer. The streaming guard drops them, but messages stored
  // before that guard existed - and text that arrives through paths without a
  // thinking strategy - still have to render cleanly, so strip them here too.
  // Done before the detector fast path, which would otherwise return untouched.
  if (containsTemplateTokens(text)) {
    text = stripTemplateTokens(text);
    if (!text) return '';
  }
  
  // 快速路径：使用统一的 ToolCallDetector 进行检测
  const detector = ToolCallDetector.getInstance();
  if (!detector.mightContainToolCall(text)) {
    return text;
  }
  
  let result = text;
  const { mode, preserveNewlines = true } = options;
  
  // 1. 使用 Pipeline 统一清理所有格式
  try {
    const pipeline = getDefaultPipeline();
    const cleanResult = pipeline.clean(result, { mode, preserveNewlines });
    result = cleanResult.text;
  } catch (e) {
    console.warn('[filterToolInstructions] Pipeline 清理失败，使用降级逻辑:', e);
    // 降级：使用旧的清理逻辑
    result = fallbackClean(result);
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
 * 降级清理函数（当 Pipeline 不可用时使用）
 */
function fallbackClean(text: string): string {
  let result = text;
  
  // 移除完整的 XML 指令块
  result = result.replace(/<use_mcp_tool>[\s\S]*?<\/use_mcp_tool>/gi, '');
  result = result.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
  
  // 移除 JSON 格式的工具调用
  result = result.replace(/\{[\s\S]*?"type"\s*:\s*"tool_call"[\s\S]*?\}/gi, '');
  
  // 移除内部标记
  result = result.replace(/\{[^}]*"__tool_call_card__"[^}]*\}/g, '');
  
  // 移除 GPT-OSS 模板标签
  result = result.replace(/<\|(?:channel|message|end|thinking|constrain|tool_calls?|function_calls?|assistant|user|system)\|>/gi, '');
  
  return result;
}

/**
 * 清理未完成的指令片段（流式输出场景）
 * 
 * ⚠️ 重要：只清理明确的 MCP 工具调用指令和 GPT-OSS 模板标签
 */
function cleanIncompleteInstructions(text: string): string {
  if (!text) return '';
  
  let result = text;
  
  // 0. 首先清理独立出现的 GPT-OSS 模板标签（这些总是应该被移除）
  result = result.replace(/<\|(?:channel|message|end|thinking|constrain|tool_calls?|function_calls?|assistant|user|system|start|call|final|response)\|>/gi, '');
  
  // 0.1 清理独立出现的 "commentary" 关键字（GPT-OSS 遗留片段）
  // 这通常是 "commentary to=..." 指令被部分清理后留下的
  result = result.replace(/^\s*commentary\s*$/gm, '');
  result = result.replace(/\s+commentary\s+$/g, ' ');
  result = result.replace(/^commentary\s+/g, '');
  
  // 0.2 清理不完整的 commentary to= 指令（未完成的流式输出）
  result = result.replace(/commentary\s+to=[^\s<>]+[\s\S]*$/gi, '');
  
  // 1. 只移除未完成的 MCP 工具调用 XML 指令块
  result = result.replace(INCOMPLETE_XML_PATTERNS.xml_use_mcp_tool, '');
  result = result.replace(INCOMPLETE_XML_PATTERNS.xml_tool_call, '');
  
  // 2. 清理不完整的标签前缀（MCP 标签和 GPT-OSS 标签）
  for (const tag of INCOMPLETE_TAG_PREFIXES) {
    const minLen = tag.startsWith('<|') ? 2 : MIN_INCOMPLETE_PREFIX_LENGTH;
    for (let len = tag.length; len >= minLen; len--) {
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
  
  // 1. 清理所有 GPT-OSS 模板标签（独立出现的）
  // 这些标签是模型内部结构标记，不应该显示给用户
  result = result.replace(/<\|(?:channel|message|end|thinking|constrain|tool_calls?|function_calls?|assistant|user|system)\|>/gi, '');
  
  // 2. 缺少 JSON 体的半截 GPT-OSS 指令
  result = result.replace(
    /commentary\s+to=[^\s]+[\s\S]*?(?:<\|message\|>)?\s*$/gi,
    ''
  );
  
  // 3. 无标签 GPT-OSS 变体（必须包含完整的 "commentary to=... json {...}" 结构）
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

