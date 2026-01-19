/**
 * 简化格式处理器
 * 
 * 支持各种简化的工具调用格式
 * 
 * ## 格式示例
 * 
 * 1. to= 格式:
 *    to=web_search.search {"query": "test"}
 * 
 * 2. 函数式格式:
 *    web_search.search {"query": "test"}
 * 
 * 3. 分隔符格式:
 *    to=>>server>>tool>>{...}>>
 */

import type { 
  FormatHandler, 
  ParsedToolCall, 
  ProcessResult, 
  CleanOptions,
  ToolCallFormat 
} from '../types';

export class SimpleHandler implements FormatHandler {
  readonly id: ToolCallFormat = 'function_like';
  readonly description = '简化格式（to=, server.tool, 分隔符）';
  readonly priority = 10;

  // to= 格式
  private readonly toEqualsPattern = /(?:^|\s)to\s*=\s*([a-z0-9_.-]+)\s*(\{[\s\S]*?\})/gi;
  
  // 函数式格式（更严格，避免误匹配）
  private readonly functionLikePattern = /(?:^|\n)\s*([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s*(\{[\s\S]*?\})/gi;
  
  // 分隔符格式
  private readonly separatorPattern = /to\s*=\s*>+([a-z0-9_-]+)>+([a-z0-9_-]+)>+\s*(\{[\s\S]*?\})>+/gi;

  mightContain(text: string): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    
    // 快速检测
    return (
      // to= 格式
      /(?:^|\s)to\s*=\s*[a-z]/i.test(text) ||
      // 分隔符格式
      lower.includes('to=>>') ||
      // 函数式格式（需要 . 和 { 的组合）
      /[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\s*\{/i.test(text)
    );
  }

  parse(text: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];
    
    // 解析 to= 格式
    results.push(...this.parseToEquals(text));
    
    // 解析分隔符格式
    results.push(...this.parseSeparator(text));
    
    // 解析函数式格式（最后，因为容易误匹配）
    results.push(...this.parseFunctionLike(text));
    
    return results;
  }

  private parseToEquals(text: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];
    const pattern = new RegExp(this.toEqualsPattern.source, 'gi');
    let match;
    
    while ((match = pattern.exec(text)) !== null) {
      const target = match[1].trim();
      const argsStr = match[2];
      
      const { server, tool } = this.parseTarget(target);
      
      let args: Record<string, unknown> | undefined;
      if (argsStr) {
        try {
          args = JSON.parse(argsStr);
        } catch { /* ignore */ }
      }
      
      results.push({
        server,
        tool,
        args,
        rawText: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        format: 'commentary_simple',
        confidence: 0.75,
      });
    }
    
    return results;
  }

  private parseSeparator(text: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];
    const pattern = new RegExp(this.separatorPattern.source, 'gi');
    let match;
    
    while ((match = pattern.exec(text)) !== null) {
      const server = match[1].trim();
      const tool = match[2].trim();
      const argsStr = match[3];
      
      let args: Record<string, unknown> | undefined;
      if (argsStr) {
        try {
          args = JSON.parse(argsStr);
        } catch { /* ignore */ }
      }
      
      results.push({
        server,
        tool,
        args,
        rawText: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        format: 'function_like',
        confidence: 0.7,
      });
    }
    
    return results;
  }

  private parseFunctionLike(text: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];
    const pattern = new RegExp(this.functionLikePattern.source, 'gi');
    let match;
    
    while ((match = pattern.exec(text)) !== null) {
      const server = match[1].trim();
      const tool = match[2].trim();
      const argsStr = match[3];
      
      // 过滤掉常见的非工具调用模式
      if (this.isLikelyNotToolCall(server, tool)) {
        continue;
      }
      
      let args: Record<string, unknown> | undefined;
      if (argsStr) {
        try {
          args = JSON.parse(argsStr);
        } catch { /* ignore */ }
      }
      
      results.push({
        server,
        tool,
        args,
        rawText: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        format: 'function_like',
        confidence: 0.6,
      });
    }
    
    return results;
  }

  /**
   * 检查是否可能不是工具调用
   * 用于过滤常见的误匹配
   */
  private isLikelyNotToolCall(server: string, tool: string): boolean {
    // 常见的非工具调用模式
    const nonToolPatterns = [
      // 常见的库名
      'socket', 'console', 'window', 'document', 'process',
      'react', 'vue', 'angular', 'jquery', 'lodash',
      'axios', 'fetch', 'http', 'https', 'fs', 'path',
      // 常见的对象方法
      'object', 'array', 'string', 'number', 'math',
      'json', 'date', 'regexp', 'promise',
      // CSS 相关
      'style', 'styles', 'css', 'sass', 'less',
    ];
    
    const serverLower = server.toLowerCase();
    const toolLower = tool.toLowerCase();
    
    // 检查是否匹配已知的非工具调用模式
    if (nonToolPatterns.includes(serverLower)) {
      return true;
    }
    
    // 检查是否是常见的方法调用
    const commonMethods = ['log', 'error', 'warn', 'info', 'debug', 'trace'];
    if (commonMethods.includes(toolLower)) {
      return true;
    }
    
    return false;
  }

  /**
   * 解析 target 字符串为 server.tool
   */
  private parseTarget(target: string): { server: string; tool: string } {
    if (!target) return { server: 'unknown', tool: 'unknown' };
    
    if (target.includes('.')) {
      const parts = target.split('.');
      return { server: parts[0], tool: parts.slice(1).join('.') };
    }
    
    return { server: target, tool: 'default' };
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
    let result = text;
    
    // 移除不完整的 to= 格式
    result = result.replace(/(?:^|\s)to\s*=\s*[a-z0-9_.-]+\s*\{[^}]*$/gi, '');
    
    // 移除不完整的分隔符格式
    result = result.replace(/to\s*=\s*>+[a-z0-9_-]+>+[a-z0-9_-]+>+\s*\{[^}]*$/gi, '');
    
    return result;
  }
}

