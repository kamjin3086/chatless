/**
 * JSON 格式处理器
 * 
 * 支持各种 JSON 格式的工具调用
 * 
 * ## 格式示例
 * 
 * 1. type: tool_call 格式:
 *    {"type": "tool_call", "server": "web_search", "tool": "search", "args": {"query": "test"}}
 * 
 * 2. 简化格式:
 *    {"server": "web_search", "tool": "search", "arguments": {"query": "test"}}
 * 
 * 3. 内部标记格式:
 *    {"__tool_call_card__": true, "server": "web_search", "tool": "search"}
 */

import type { 
  FormatHandler, 
  ParsedToolCall, 
  ProcessResult, 
  CleanOptions,
  ToolCallFormat 
} from '../types';
import { parsePartialJson } from '@/lib/utils/partialJsonParser';

export class JsonHandler implements FormatHandler {
  readonly id: ToolCallFormat = 'json_tool_call';
  readonly description = 'JSON 格式工具调用';
  readonly priority = 9;

  // 检测特征
  private readonly typeToolCallPattern = /"type"\s*:\s*"tool_call"/i;
  private readonly internalMarkerPattern = /"__tool_call_card__"/;
  private readonly serverToolPattern = /"(?:server|serverName)"\s*:\s*"[^"]+"\s*,\s*"(?:tool|toolName)"\s*:\s*"/;

  mightContain(text: string): boolean {
    if (!text) return false;
    
    return (
      this.typeToolCallPattern.test(text) ||
      this.internalMarkerPattern.test(text) ||
      this.serverToolPattern.test(text)
    );
  }

  parse(text: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];
    
    // 查找所有 JSON 对象
    const jsonObjects = this.extractJsonObjects(text);
    
    for (const { json, raw, startIndex, endIndex } of jsonObjects) {
      const parsed = this.parseJsonObject(json, raw, startIndex, endIndex);
      if (parsed) {
        results.push(parsed);
      }
    }
    
    return results;
  }

  /**
   * 提取文本中的所有 JSON 对象
   * 使用括号匹配算法正确处理嵌套
   */
  private extractJsonObjects(text: string): Array<{
    json: Record<string, unknown>;
    raw: string;
    startIndex: number;
    endIndex: number;
  }> {
    const results: Array<{
      json: Record<string, unknown>;
      raw: string;
      startIndex: number;
      endIndex: number;
    }> = [];

    let i = 0;
    while (i < text.length) {
      if (text[i] === '{') {
        const endIndex = this.findMatchingBrace(text, i);
        
        if (endIndex !== -1) {
          const raw = text.substring(i, endIndex + 1);
          
          // 只处理可能是工具调用的 JSON
          if (this.mightBeToolCall(raw)) {
            // 使用增量 JSON 解析器，支持不完整 JSON
            const json = parsePartialJson<Record<string, unknown>>(raw);
            if (json && typeof json === 'object') {
              results.push({
                json,
                raw,
                startIndex: i,
                endIndex: endIndex + 1,
              });
            }
          }
          
          i = endIndex + 1;
          continue;
        }
      }
      i++;
    }

    return results;
  }

  /**
   * 快速检测 JSON 字符串是否可能是工具调用
   */
  private mightBeToolCall(jsonStr: string): boolean {
    return (
      this.typeToolCallPattern.test(jsonStr) ||
      this.internalMarkerPattern.test(jsonStr) ||
      this.serverToolPattern.test(jsonStr)
    );
  }

  /**
   * 找到匹配的右花括号
   */
  private findMatchingBrace(text: string, start: number): number {
    if (text[start] !== '{') return -1;
    
    let depth = 0;
    let inString = false;
    let escape = false;
    
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      
      if (escape) {
        escape = false;
        continue;
      }
      
      if (char === '\\' && inString) {
        escape = true;
        continue;
      }
      
      if (char === '"' && !escape) {
        inString = !inString;
        continue;
      }
      
      if (inString) continue;
      
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          return i;
        }
      }
    }
    
    return -1;
  }

  /**
   * 解析 JSON 对象为工具调用
   */
  private parseJsonObject(
    json: Record<string, unknown>,
    raw: string,
    startIndex: number,
    endIndex: number
  ): ParsedToolCall | null {
    // 检查是否是 type: tool_call 格式
    if (json.type === 'tool_call') {
      return {
        server: String(json.server || json.serverName || 'unknown'),
        tool: String(json.tool || json.toolName || json.name || 'unknown'),
        args: (json.args || json.arguments) as Record<string, unknown> | undefined,
        rawText: raw,
        startIndex,
        endIndex,
        format: 'json_tool_call',
        confidence: 0.95,
      };
    }

    // 检查是否是内部标记格式
    if (json.__tool_call_card__) {
      return {
        server: String(json.server || 'unknown'),
        tool: String(json.tool || 'unknown'),
        args: json.args as Record<string, unknown> | undefined,
        rawText: raw,
        startIndex,
        endIndex,
        format: 'internal_marker',
        confidence: 1.0,
      };
    }

    // 检查是否有 server 和 tool 字段
    const server = json.server || json.serverName;
    const tool = json.tool || json.toolName || json.name;
    
    if (server && tool) {
      return {
        server: String(server),
        tool: String(tool),
        args: (json.args || json.arguments) as Record<string, unknown> | undefined,
        rawText: raw,
        startIndex,
        endIndex,
        format: 'json_tool_call',
        confidence: 0.8,
      };
    }

    return null;
  }

  clean(text: string, _options?: CleanOptions): ProcessResult {
    if (!this.mightContain(text)) {
      return { text, toolCalls: [], processed: false };
    }

    const toolCalls = this.parse(text);
    let cleaned = text;
    const removedFragments: string[] = [];

    // 从后向前移除，避免索引偏移
    const sortedCalls = [...toolCalls].sort((a, b) => b.startIndex - a.startIndex);
    
    for (const tc of sortedCalls) {
      removedFragments.push(tc.rawText);
      cleaned = cleaned.slice(0, tc.startIndex) + cleaned.slice(tc.endIndex);
    }

    return {
      text: cleaned.trim(),
      toolCalls,
      processed: toolCalls.length > 0,
      removedFragments,
    };
  }

  cleanIncomplete(text: string): string {
    // 移除不完整的 JSON 对象
    // 检测末尾是否有未闭合的 {
    let result = text;
    
    // 查找最后一个未闭合的 {
    let depth = 0;
    let lastOpenBrace = -1;
    let inString = false;
    let escape = false;
    
    for (let i = 0; i < result.length; i++) {
      const char = result[i];
      
      if (escape) {
        escape = false;
        continue;
      }
      
      if (char === '\\' && inString) {
        escape = true;
        continue;
      }
      
      if (char === '"' && !escape) {
        inString = !inString;
        continue;
      }
      
      if (inString) continue;
      
      if (char === '{') {
        if (depth === 0) {
          lastOpenBrace = i;
        }
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          lastOpenBrace = -1;
        }
      }
    }
    
    // 如果有未闭合的 {，检查是否可能是工具调用
    if (lastOpenBrace !== -1 && depth > 0) {
      const fragment = result.slice(lastOpenBrace);
      if (this.mightBeToolCall(fragment)) {
        result = result.slice(0, lastOpenBrace);
      }
    }
    
    return result;
  }
}

