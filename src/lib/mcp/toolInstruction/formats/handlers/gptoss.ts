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
  // 注意：[^\s<>]+ 确保不包含 > 字符，避免匹配到 use_mcp_tool> 这种混合格式
  private readonly toolCallPattern = 
    /<\|channel\|>\s*commentary\s+to=([^\s<>]+)[\s\S]*?(?:<\|(?:message|constrain)\|>[\s\S]*?)?(\{[\s\S]*?\})(?:\s*<\|(?:end|call)\|>)?/gi;

  // 匹配 commentary 格式（无通道标签）
  // 注意：[^\s<>]+ 确保不包含 > 字符
  private readonly commentaryPattern = 
    /commentary\s+to=([^\s<>]+)(?:\s+(?:json|code))?\s*(\{[\s\S]*?\})/gi;
  
  // 匹配带 > 分隔符的格式：commentary to=server.tool>{"arg":"value"}
  // 这是 GPT-OSS 常见的变体格式
  private readonly commentaryWithSeparatorPattern = 
    /commentary\s+to=([a-zA-Z0-9_.]+)>(\{[^}]*\})/gi;
  
  // 匹配带 <json> 标签的格式：commentary to=server.tool><json>{"arg":"value"}></json>
  // GPT-OSS 有时使用 <json> 标签包裹参数
  private readonly commentaryWithJsonTagPattern = 
    /commentary\s+to=([a-zA-Z0-9_.]+)>\s*<json>\s*(\{[\s\S]*?\})\s*<\/json>/gi;

  // 匹配带 tool_name= 的变体：
  // 例如：commentary to=web_search tool_name=search code{"query":"..."}
  private readonly commentaryWithToolNamePattern =
    /commentary\s+to=([a-zA-Z0-9_.]+)\s+tool_name\s*=\s*([a-zA-Z0-9_.-]+)\s+(?:json|code)?\s*(\{[\s\S]*?\})/gi;

  // 匹配“无 <|channel|> 但带 <|constrain|>json<|message|>”的变体：
  // 例如：commentary to=web_search.search <|constrain|>json<|message|>{"query":"..."}
  private readonly commentaryConstrainMessagePattern =
    /commentary\s+to=([^\s<>]+)[\s\S]*?<\|message\|>\s*(\{[\s\S]*?\})(?:\s*<\|(?:end|call)\|>)?/gi;
  
  // 匹配混合格式：commentary to=use_mcp_tool><server_name>...</use_mcp_tool>
  // 这是模型混淆 GPT-OSS 和 XML 格式时产生的
  private readonly hybridXmlPattern = 
    /commentary\s+to=use_mcp_tool><server_name>\s*([^<]+)\s*<\/server_name>\s*<tool_name>\s*([^<]+)\s*<\/tool_name>\s*<arguments>\s*([\s\S]*?)\s*<\/arguments>\s*<\/use_mcp_tool>/gi;

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
    
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/9f8e7fe1-428e-4909-b4e4-b7238838d737',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'gptoss.ts:parse:entry',message:'GptOssHandler 解析开始',data:{textLen:text.length,textSample:text.slice(0,200)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H6-parse'})}).catch(()=>{});
    // #endregion
    
    // 首先检查混合格式（commentary to=use_mcp_tool>...）
    // 这种格式优先级最高，因为它是模型格式混淆的结果
    results.push(...this.parseHybridXml(text));
    
    // 解析带通道标签的工具调用
    results.push(...this.parseChannelToolCall(text));
    
    // 解析简化的 commentary
    results.push(...this.parseCommentary(text));
    
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/9f8e7fe1-428e-4909-b4e4-b7238838d737',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'gptoss.ts:parse:exit',message:'GptOssHandler 解析完成',data:{resultsCount:results.length,results:results.map(r=>({server:r.server,tool:r.tool,args:r.args}))},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H6-parse'})}).catch(()=>{});
    // #endregion
    
    return results;
  }
  
  /**
   * 解析混合格式：commentary to=use_mcp_tool><server_name>...</use_mcp_tool>
   * 这是模型混淆 GPT-OSS 和 XML 格式时产生的特殊格式
   */
  private parseHybridXml(text: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];
    const pattern = new RegExp(this.hybridXmlPattern.source, 'gi');
    let match;
    
    while ((match = pattern.exec(text)) !== null) {
      const server = match[1].trim();
      const tool = match[2].trim();
      const argsStr = match[3].trim();
      
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
        format: 'gpt_oss_channel', // 标记为 GPT-OSS 格式（混合变体）
        confidence: 0.95, // 高置信度，因为格式非常明确
      });
    }
    
    return results;
  }

  private parseChannelToolCall(text: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];
    const pattern = new RegExp(this.toolCallPattern.source, 'gi');
    let match;
    
    while ((match = pattern.exec(text)) !== null) {
      const target = match[1].trim();
      const argsStr = match[2];
      
      const parsed = this.parseTarget(target);
      // 跳过无法解析的目标
      if (!parsed) continue;
      
      const { server, tool } = parsed;
      
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
    
    // 1. 解析标准格式：commentary to=xxx json {...}
    const pattern = new RegExp(this.commentaryPattern.source, 'gi');
    let match;
    
    while ((match = pattern.exec(text)) !== null) {
      const target = match[1].trim();
      const argsStr = match[2];
      
      const parsed = this.parseTarget(target);
      // 跳过无法解析的目标
      if (!parsed) continue;
      
      const { server, tool } = parsed;
      
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
    
    // 2. 解析带 > 分隔符的格式：commentary to=server.tool>{"arg":"value"}
    const separatorPattern = new RegExp(this.commentaryWithSeparatorPattern.source, 'gi');
    while ((match = separatorPattern.exec(text)) !== null) {
      const target = match[1].trim();
      const argsStr = match[2];
      
      const parsed = this.parseTarget(target);
      if (!parsed) continue;
      
      const { server, tool } = parsed;
      
      let args: Record<string, unknown> | undefined;
      if (argsStr) {
        try {
          args = JSON.parse(argsStr);
        } catch { /* ignore */ }
      }
      
      // 避免重复：检查是否已存在相同位置的结果
      const isDuplicate = results.some(r => 
        r.startIndex === match!.index || 
        (r.server === server && r.tool === tool)
      );
      
      if (!isDuplicate) {
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
    }
    
    // 3. 解析带 <json> 标签的格式：commentary to=server.tool><json>{"arg":"value"}></json>
    const jsonTagPattern = new RegExp(this.commentaryWithJsonTagPattern.source, 'gi');
    while ((match = jsonTagPattern.exec(text)) !== null) {
      const target = match[1].trim();
      const argsStr = match[2];
      
      const parsed = this.parseTarget(target);
      if (!parsed) continue;
      
      const { server, tool } = parsed;
      
      let args: Record<string, unknown> | undefined;
      if (argsStr) {
        try {
          args = JSON.parse(argsStr);
        } catch { /* ignore */ }
      }
      
      // 避免重复
      const isDuplicate = results.some(r => 
        r.startIndex === match!.index || 
        (r.server === server && r.tool === tool)
      );
      
      if (!isDuplicate) {
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
    }

    // 4. 解析带 tool_name= 的变体：commentary to=server tool_name=tool code{...}
    const toolNamePattern = new RegExp(this.commentaryWithToolNamePattern.source, 'gi');
    while ((match = toolNamePattern.exec(text)) !== null) {
      const server = match[1].trim();
      const tool = match[2].trim();
      const argsStr = match[3];

      if (!server || !tool) continue;

      let args: Record<string, unknown> | undefined;
      if (argsStr) {
        try {
          args = JSON.parse(argsStr);
        } catch { /* ignore */ }
      }

      // 避免重复
      const isDuplicate = results.some(r => r.startIndex === match!.index || (r.server === server && r.tool === tool));
      if (!isDuplicate) {
        results.push({
          server,
          tool,
          args,
          rawText: match[0],
          startIndex: match.index,
          endIndex: match.index + match[0].length,
          format: 'gpt_oss_commentary',
          confidence: 0.86,
        });
      }
    }

    // 5. 解析带 <|message|> 的变体（常见于 <|constrain|>json<|message|> 拆包）
    // 例如：commentary to=web_search.search <|constrain|>json<|message|>{"query":"..."}
    const constrainPattern = new RegExp(this.commentaryConstrainMessagePattern.source, 'gi');
    while ((match = constrainPattern.exec(text)) !== null) {
      const target = match[1].trim();
      const argsStr = match[2];

      const parsed = this.parseTarget(target);
      if (!parsed) continue;

      const { server, tool } = parsed;

      let args: Record<string, unknown> | undefined;
      if (argsStr) {
        try {
          args = JSON.parse(argsStr);
        } catch { /* ignore */ }
      }

      const isDuplicate = results.some(r => r.startIndex === match!.index || (r.server === server && r.tool === tool));
      if (!isDuplicate) {
        results.push({
          server,
          tool,
          args,
          rawText: match[0],
          startIndex: match.index,
          endIndex: match.index + match[0].length,
          format: 'gpt_oss_commentary',
          confidence: 0.84,
        });
      }
    }
    
    return results;
  }

  /**
   * 解析 target 字符串为 server.tool
   * 支持格式: "server.tool", "functions.server.tool"
   * 返回 null 如果无法解析或格式错误
   */
  private parseTarget(target: string): { server: string; tool: string } | null {
    if (!target) return null;
    
    // 如果 target 包含 use_mcp_tool 或 > 字符，说明是混合格式的错误解析
    // 这种情况应该被 hybridXmlPattern 处理
    if (target.includes('use_mcp_tool') || target.includes('>')) {
      return null;
    }
    
    // 移除 "functions." 前缀
    const cleaned = target.replace(/^functions\./, '');
    
    if (cleaned.includes('.')) {
      const parts = cleaned.split('.');
      const server = parts[0];
      const tool = parts.slice(1).join('.');
      
      // 确保 server 和 tool 都非空
      if (!server || !tool) return null;
      
      return { server, tool };
    }
    
    // 兼容：某些 GPT-OSS 变体只输出 server（缺 tool）
    // 目前只对 web_search 兜底为 search，避免误把其他 server-only 文本解析为工具调用。
    if (cleaned === 'web_search') {
      return { server: 'web_search', tool: 'search' };
    }
    return null;
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
    
    // 3.5 移除混合格式 commentary to=use_mcp_tool>...
    const hybridPattern = new RegExp(this.hybridXmlPattern.source, 'gi');
    cleaned = cleaned.replace(hybridPattern, (match) => {
      removedFragments.push(match);
      return '';
    });
    
    // 3.6 移除不完整的混合格式（流式场景）
    // 例如: commentary to=use_mcp_tool><server_name>docx... (未闭合)
    cleaned = cleaned.replace(/commentary\s+to=use_mcp_tool>[\s\S]*$/gi, '');

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

