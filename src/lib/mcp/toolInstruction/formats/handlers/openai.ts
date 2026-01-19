/**
 * OpenAI 格式处理器
 * 
 * 支持 OpenAI 标准的 function_call 和 tool_calls 格式
 * 
 * ## 格式示例
 * 
 * 1. function_call 格式:
 *    {"function_call": {"name": "get_weather", "arguments": "{\"location\": \"Beijing\"}"}}
 * 
 * 2. tool_calls 格式:
 *    {"tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "search", "arguments": "{}"}}]}
 */

import type { 
  FormatHandler, 
  ParsedToolCall, 
  ProcessResult, 
  CleanOptions,
  ToolCallFormat 
} from '../types';

export class OpenAIHandler implements FormatHandler {
  readonly id: ToolCallFormat = 'openai_function_call';
  readonly description = 'OpenAI function_call 和 tool_calls 格式';
  readonly priority = 1;

  // 检测模式
  private readonly functionCallPattern = /"function_call"\s*:\s*\{/;
  private readonly toolCallsPattern = /"tool_calls"\s*:\s*\[/;

  mightContain(text: string): boolean {
    if (!text) return false;
    return this.functionCallPattern.test(text) || this.toolCallsPattern.test(text);
  }

  parse(text: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];
    
    // 尝试解析 function_call
    const fcResults = this.parseFunctionCall(text);
    results.push(...fcResults);
    
    // 尝试解析 tool_calls
    const tcResults = this.parseToolCalls(text);
    results.push(...tcResults);
    
    return results;
  }

  private parseFunctionCall(text: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];
    
    // 匹配 function_call 对象
    const regex = /\{[^{}]*"function_call"\s*:\s*(\{(?:[^{}]|\{[^{}]*\})*\})[^{}]*\}/g;
    let match;
    
    while ((match = regex.exec(text)) !== null) {
      try {
        const fcStr = match[1];
        const fc = JSON.parse(fcStr);
        
        if (fc.name) {
          // 解析 arguments
          let args: Record<string, unknown> | undefined;
          if (fc.arguments) {
            try {
              args = typeof fc.arguments === 'string' 
                ? JSON.parse(fc.arguments) 
                : fc.arguments;
            } catch { /* ignore */ }
          }
          
          // 从 name 中提取 server 和 tool
          const [server, tool] = this.parseNameToServerTool(fc.name);
          
          results.push({
            server,
            tool,
            args,
            rawText: match[0],
            startIndex: match.index,
            endIndex: match.index + match[0].length,
            format: 'openai_function_call',
            confidence: 0.95,
          });
        }
      } catch { /* ignore parse errors */ }
    }
    
    return results;
  }

  private parseToolCalls(text: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];
    
    // 查找 tool_calls 数组
    const regex = /"tool_calls"\s*:\s*\[([\s\S]*?)\]/g;
    let match;
    
    while ((match = regex.exec(text)) !== null) {
      try {
        const arrayContent = `[${match[1]}]`;
        const toolCalls = JSON.parse(arrayContent);
        
        if (Array.isArray(toolCalls)) {
          for (const tc of toolCalls) {
            if (tc.type === 'function' && tc.function) {
              const fn = tc.function;
              
              let args: Record<string, unknown> | undefined;
              if (fn.arguments) {
                try {
                  args = typeof fn.arguments === 'string' 
                    ? JSON.parse(fn.arguments) 
                    : fn.arguments;
                } catch { /* ignore */ }
              }
              
              const [server, tool] = this.parseNameToServerTool(fn.name || '');
              
              results.push({
                server,
                tool,
                args,
                rawText: JSON.stringify(tc),
                startIndex: match.index,
                endIndex: match.index + match[0].length,
                format: 'openai_tool_calls',
                confidence: 0.95,
              });
            }
          }
        }
      } catch { /* ignore parse errors */ }
    }
    
    return results;
  }

  /**
   * 将函数名解析为 server.tool 格式
   * 例如: "get_weather" -> ["default", "get_weather"]
   *       "web_search.search" -> ["web_search", "search"]
   */
  private parseNameToServerTool(name: string): [string, string] {
    if (!name) return ['unknown', 'unknown'];
    
    if (name.includes('.')) {
      const parts = name.split('.');
      return [parts[0], parts.slice(1).join('.')];
    }
    
    // 尝试识别常见的服务器前缀
    const knownServers = ['web_search', 'filesystem', 'git', 'code'];
    for (const server of knownServers) {
      if (name.startsWith(server + '_')) {
        return [server, name.slice(server.length + 1)];
      }
    }
    
    return ['default', name];
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
    // 清理不完整的 function_call 或 tool_calls
    // 例如: {"function_call": {"name": "test
    let result = text;
    
    // 移除不完整的 function_call
    result = result.replace(/"function_call"\s*:\s*\{[^}]*$/g, '');
    
    // 移除不完整的 tool_calls
    result = result.replace(/"tool_calls"\s*:\s*\[[^\]]*$/g, '');
    
    return result;
  }
}

