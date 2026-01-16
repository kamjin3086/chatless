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
 */
function cleanIncompleteInstructions(text: string): string {
  if (!text) return '';
  
  let result = text;
  
  // 1. 移除未完成的 XML 指令块
  for (const pattern of TOOL_INSTRUCTION_PATTERNS) {
    if (pattern.incompletePattern) {
      result = result.replace(pattern.incompletePattern, '');
    }
  }
  
  // 2. 清理不完整的标签前缀
  for (const tag of INCOMPLETE_TAG_PREFIXES) {
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
 */
function cleanGptOssVariants(text: string): string {
  if (!text) return '';
  
  let result = text;
  
  // 缺少 JSON 体的半截 GPT-OSS 指令
  result = result.replace(
    /<\|channel\|>\s*commentary\s+to=[^\s]+[\s\S]*?(?:<\|message\|>)?\s*$/gi,
    ''
  );
  
  // 无标签 GPT-OSS 变体
  result = result.replace(/commentary\s+to=[^\n]+?\s+json\s*\{[\s\S]*?\}/gi, '');
  
  // 极简变体残片
  result = result.replace(/(?:^|\s)to\s*=\s*[a-z0-9_.-]+\s*\{?$/i, '');
  
  // 函数式变体残片
  result = result.replace(/(?:^|\s)[a-z0-9_]+\.[a-z0-9_]+\s*\{?$/i, '');
  
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

