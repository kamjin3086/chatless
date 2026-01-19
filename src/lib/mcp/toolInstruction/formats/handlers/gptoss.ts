/**
 * GPT-OSS / Harmony 格式处理器
 * 
 * 支持 GPT-OSS 模型的通道标签和 commentary 格式
 * 
 * ## 格式示例
 * 
 * 1. 完整通道格式:
 *    <|channel|>commentary to=web_search.search<|message|>{"query": "test"}<|end|>
 * 
 * 2. 带约束的格式:
 *    <|start|>assistant<|channel|>commentary to=functions.get_weather<|constrain|>json<|message|>{"location": "Beijing"}<|call|>
 * 
 * 3. 简化 commentary 格式:
 *    commentary to=web_search.search json {"query": "test"}
 * 
 * 4. 独立模板标签（需要清理）:
 *    <|channel|>, <|message|>, <|end|>, <|thinking|>, <|constrain|>
 */

import type { 
  FormatHandler, 
  ParsedToolCall, 
  ProcessResult, 
  CleanOptions,
  ToolCallFormat 
} from '../types';

export class GptOssHandler implements FormatHandler {
  readonly id: ToolCallFormat = 'gpt_oss_channel';
  readonly description = 'GPT-OSS 通道格式和模板标签';
  readonly priority = 6;

  // 所有 GPT-OSS 模板标签
  private readonly allTags = [
    'channel', 'message', 'end', 'thinking', 'constrain', 
    'tool_call', 'tool_calls', 'function_call', 'function_calls',
    'assistant', 'user', 'system', 'start', 'call', 'final', 'response'
  ];

  // 匹配独立的模板标签
  private readonly tagPattern: RegExp;

  // 匹配完整的工具调用
  private readonly toolCallPattern = 
    /<\|channel\|>\s*commentary\s+to=([^\s<]+)[\s\S]*?(?:<\|(?:message|constrain)\|>[\s\S]*?)?(\{[\s\S]*?\})(?:\s*<\|(?:end|call)\|>)?/gi;

  // 匹配 commentary 格式（无通道标签）
  private readonly commentaryPattern = 
    /commentary\s+to=([^\s<]+)(?:\s+(?:json|code))?\s*(\{[\s\S]*?\})/gi;

  // 匹配 analysis/thinking 块
  private readonly analysisPattern = 
    /<\|channel\|>\s*analysis[\s\S]*?<\|channel\|>\s*(?:final|response)/gi;

  constructor() {
    // 动态构建标签匹配模式
    const tagAlternation = this.allTags.join('|');
    this.tagPattern = new RegExp(`<\\|(?:${tagAlternation})\\|>`, 'gi');
  }

  mightContain(text: string): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    
    return (
      text.includes('<|') ||
      lower.includes('commentary to=') ||
      // 支持反向格式: json{...}commentary
      (lower.includes('json') && lower.includes('commentary'))
    );
  }

  parse(text: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];
    
    // 解析带通道标签的工具调用
    results.push(...this.parseChannelToolCall(text));
    
    // 解析简化的 commentary
    results.push(...this.parseCommentary(text));
    
    return results;
  }

  private parseChannelToolCall(text: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];
    const pattern = new RegExp(this.toolCallPattern.source, 'gi');
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
        format: 'gpt_oss_channel',
        confidence: 0.9,
      });
    }
    
    return results;
  }

  private parseCommentary(text: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];
    const pattern = new RegExp(this.commentaryPattern.source, 'gi');
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
        format: 'gpt_oss_commentary',
        confidence: 0.85,
      });
    }
    
    return results;
  }

  /**
   * 解析 target 字符串为 server.tool
   * 支持格式: "server.tool", "functions.server.tool", "server"
   */
  private parseTarget(target: string): { server: string; tool: string } {
    if (!target) return { server: 'unknown', tool: 'unknown' };
    
    // 移除 "functions." 前缀
    const cleaned = target.replace(/^functions\./, '');
    
    if (cleaned.includes('.')) {
      const parts = cleaned.split('.');
      return { server: parts[0], tool: parts.slice(1).join('.') };
    }
    
    // 只有服务器名，尝试推断工具名
    return { server: cleaned, tool: 'default' };
  }

  clean(text: string, _options?: CleanOptions): ProcessResult {
    if (!this.mightContain(text)) {
      return { text, toolCalls: [], processed: false };
    }

    let cleaned = text;
    const removedFragments: string[] = [];

    // 1. 移除完整的工具调用（带通道标签）
    const tcPattern = new RegExp(this.toolCallPattern.source, 'gi');
    cleaned = cleaned.replace(tcPattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    // 2. 移除 analysis/thinking 块
    cleaned = cleaned.replace(this.analysisPattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    // 3. 移除简化的 commentary（需谨慎，可能是正常内容）
    const commentPattern = new RegExp(this.commentaryPattern.source, 'gi');
    cleaned = cleaned.replace(commentPattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    // 4. 新增: 处理 json{...}commentary to=... 格式（JSON在前，commentary在后）
    // 这是某些模型输出的变体格式
    const reversedPattern = /json\s*(\{[\s\S]*?\})\s*commentary\s+to=([^\s<\n]+)/gi;
    cleaned = cleaned.replace(reversedPattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    // 5. 移除所有独立的模板标签
    cleaned = cleaned.replace(this.tagPattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    const toolCalls = this.parse(text);

    return {
      text: cleaned.trim(),
      toolCalls,
      processed: removedFragments.length > 0,
      removedFragments,
    };
  }

  cleanIncomplete(text: string): string {
    let result = text;

    // 移除不完整的通道工具调用
    // 例如: <|channel|>commentary to=web_search...
    result = result.replace(
      /<\|channel\|>\s*commentary\s+to=[^\s<]+[\s\S]*?(?:<\|(?:message|constrain)\|>[\s\S]*?)?$/gi,
      ''
    );

    // 移除不完整的模板标签
    // 例如: <|chann 或 <|
    for (const tag of this.allTags) {
      const fullTag = `<|${tag}|>`;
      for (let len = fullTag.length - 1; len >= 2; len--) {
        const partial = fullTag.substring(0, len);
        if (result.endsWith(partial)) {
          result = result.slice(0, -partial.length);
          break;
        }
      }
    }

    // 移除孤立的 <|
    if (result.endsWith('<|')) {
      result = result.slice(0, -2);
    } else if (result.endsWith('<')) {
      // 只有当前面没有 < 时才移除，避免误删 HTML
      const lastLt = result.lastIndexOf('<');
      if (lastLt === result.length - 1) {
        // 检查是否可能是 GPT-OSS 标签的开始
        const before = result.slice(Math.max(0, lastLt - 10), lastLt);
        // 如果前面没有其他 < 或者看起来不像 HTML，才移除
        if (!before.includes('<')) {
          result = result.slice(0, -1);
        }
      }
    }

    return result;
  }
}

