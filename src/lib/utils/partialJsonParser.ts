/**
 * 增量 JSON 解析器
 * 
 * ## 设计目标
 * 
 * 提供对不完整/流式 JSON 的容错解析能力，解决以下问题：
 * 
 * 1. **流式场景**：LLM 输出的 JSON 可能被分割在多个 chunk 中
 * 2. **不完整 JSON**：JSON 可能缺少闭合括号、引号等
 * 3. **容错解析**：尽可能从部分数据中提取有效信息
 * 
 * ## 使用方式
 * 
 * ```typescript
 * import { parsePartialJson, tryParseJson } from '@/lib/utils/partialJsonParser';
 * 
 * // 容错解析不完整 JSON
 * const result = parsePartialJson('{"name": "test", "value":');
 * // result = { name: "test" }
 * 
 * // 带错误处理的解析
 * const { success, data, error } = tryParseJson('{"key": "value"}');
 * ```
 */

import { parse } from 'best-effort-json-parser';

/**
 * 解析结果类型
 */
export interface ParseResult<T = unknown> {
  /** 解析是否成功 */
  success: boolean;
  /** 解析出的数据 */
  data?: T;
  /** 错误信息（如果失败） */
  error?: string;
  /** 是否为部分解析（数据可能不完整） */
  partial?: boolean;
}

/**
 * 容错解析不完整的 JSON 字符串
 * 
 * 使用 best-effort-json-parser 处理：
 * - 缺少闭合括号的对象/数组
 * - 未完成的字符串值
 * - 末尾的逗号
 * - 其他常见的不完整 JSON 情况
 * 
 * @param jsonString 可能不完整的 JSON 字符串
 * @returns 解析出的对象，如果完全无法解析则返回 null
 */
export function parsePartialJson<T = unknown>(jsonString: string): T | null {
  if (!jsonString || typeof jsonString !== 'string') {
    return null;
  }
  
  // 清理字符串
  const cleaned = jsonString.trim();
  if (!cleaned) return null;
  
  try {
    // 首先尝试标准 JSON 解析
    return JSON.parse(cleaned) as T;
  } catch {
    // 标准解析失败，使用容错解析
    try {
      const result = parse(cleaned);
      return result as T;
    } catch {
      return null;
    }
  }
}

/**
 * 带详细结果的 JSON 解析
 * 
 * @param jsonString JSON 字符串
 * @returns 包含成功状态、数据和错误信息的结果对象
 */
export function tryParseJson<T = unknown>(jsonString: string): ParseResult<T> {
  if (!jsonString || typeof jsonString !== 'string') {
    return {
      success: false,
      error: 'Invalid input: expected string',
    };
  }
  
  const cleaned = jsonString.trim();
  if (!cleaned) {
    return {
      success: false,
      error: 'Empty string',
    };
  }
  
  // 首先尝试标准解析
  try {
    const data = JSON.parse(cleaned) as T;
    return {
      success: true,
      data,
      partial: false,
    };
  } catch (standardError) {
    // 标准解析失败，尝试容错解析
    try {
      const data = parse(cleaned) as T;
      return {
        success: true,
        data,
        partial: true,
      };
    } catch {
      return {
        success: false,
        error: `JSON parse failed: ${standardError instanceof Error ? standardError.message : String(standardError)}`,
      };
    }
  }
}

/**
 * 从文本中提取并解析 JSON 对象
 * 
 * 适用于 JSON 嵌入在其他文本中的场景
 * 
 * @param text 可能包含 JSON 的文本
 * @returns 提取并解析出的对象数组
 */
export function extractJsonObjects<T = unknown>(text: string): T[] {
  if (!text) return [];
  
  const results: T[] = [];
  
  // 查找所有可能的 JSON 对象起始位置
  let searchStart = 0;
  while (searchStart < text.length) {
    const braceIndex = text.indexOf('{', searchStart);
    if (braceIndex === -1) break;
    
    // 尝试找到匹配的闭合括号
    let depth = 0;
    let inString = false;
    let escape = false;
    let endIndex = -1;
    
    for (let i = braceIndex; i < text.length; i++) {
      const char = text[i];
      
      if (escape) {
        escape = false;
        continue;
      }
      
      if (char === '\\') {
        escape = true;
        continue;
      }
      
      if (char === '"' && !escape) {
        inString = !inString;
        continue;
      }
      
      if (!inString) {
        if (char === '{') {
          depth++;
        } else if (char === '}') {
          depth--;
          if (depth === 0) {
            endIndex = i;
            break;
          }
        }
      }
    }
    
    if (endIndex !== -1) {
      const jsonCandidate = text.substring(braceIndex, endIndex + 1);
      const parsed = parsePartialJson<T>(jsonCandidate);
      if (parsed !== null) {
        results.push(parsed);
      }
      searchStart = endIndex + 1;
    } else {
      // 没有找到闭合括号，尝试容错解析剩余部分
      const remaining = text.substring(braceIndex);
      const parsed = parsePartialJson<T>(remaining);
      if (parsed !== null) {
        results.push(parsed);
      }
      break;
    }
  }
  
  return results;
}

/**
 * 安全地获取 JSON 对象的属性值
 * 
 * @param obj 对象
 * @param path 属性路径（支持点分隔，如 'a.b.c'）
 * @param defaultValue 默认值
 * @returns 属性值或默认值
 */
export function safeGet<T = unknown>(
  obj: unknown, 
  path: string, 
  defaultValue?: T
): T | undefined {
  if (!obj || typeof obj !== 'object') {
    return defaultValue;
  }
  
  const keys = path.split('.');
  let current: unknown = obj;
  
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return defaultValue;
    }
    current = (current as Record<string, unknown>)[key];
  }
  
  return (current as T) ?? defaultValue;
}

/**
 * 检测字符串是否可能是 JSON
 * 
 * 快速检测，不进行实际解析
 */
export function mightBeJson(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  return (
    (trimmed.startsWith('{') && (trimmed.endsWith('}') || trimmed.includes('}'))) ||
    (trimmed.startsWith('[') && (trimmed.endsWith(']') || trimmed.includes(']')))
  );
}

/**
 * 规范化 JSON 字符串
 * 
 * 处理常见的格式问题：
 * - 移除末尾逗号
 * - 修复未闭合的引号
 * - 添加缺失的闭合括号
 * 
 * @param jsonString 可能有问题的 JSON 字符串
 * @returns 规范化后的字符串
 */
export function normalizeJson(jsonString: string): string {
  if (!jsonString) return '';
  
  let result = jsonString.trim();
  
  // 移除末尾逗号（在 } 或 ] 之前）
  result = result.replace(/,\s*([\]}])/g, '$1');
  
  // 计算括号平衡
  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  let escape = false;
  
  for (const char of result) {
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{') braceCount++;
      else if (char === '}') braceCount--;
      else if (char === '[') bracketCount++;
      else if (char === ']') bracketCount--;
    }
  }
  
  // 添加缺失的闭合括号
  while (braceCount > 0) {
    result += '}';
    braceCount--;
  }
  while (bracketCount > 0) {
    result += ']';
    bracketCount--;
  }
  
  return result;
}

