/**
 * XML 格式处理器
 * 
 * 支持 MCP 标准 XML 格式和其他 XML 变体
 * 
 * ## 格式示例
 * 
 * 1. MCP 标准格式:
 *    <use_mcp_tool>
 *      <server_name>web_search</server_name>
 *      <tool_name>search</tool_name>
 *      <arguments>{"query": "test"}</arguments>
 *    </use_mcp_tool>
 * 
 * 2. 通用 tool_call 格式:
 *    <tool_call>{"server": "fs", "tool": "read"}</tool_call>
 * 
 * 3. function 格式:
 *    <function=get_weather>{"location": "Beijing"}</function>
 */

import type { 
  FormatHandler, 
  ParsedToolCall, 
  ProcessResult, 
  CleanOptions,
  ToolCallFormat 
} from '../types';

export class XMLHandler implements FormatHandler {
  readonly id: ToolCallFormat = 'xml_use_mcp_tool';
  readonly description = 'XML 格式工具调用（MCP 标准、tool_call、function）';
  readonly priority = 3;

  // 完整模式
  private readonly useMcpToolPattern = /<use_mcp_tool>([\s\S]*?)<\/use_mcp_tool>/gi;
  private readonly toolCallPattern = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  private readonly functionPattern = /<function=([^>]+)>([\s\S]*?)<\/function>/gi;

  // 不完整模式
  private readonly incompleteUseMcpTool = /<use_mcp_tool>[\s\S]*$/i;
  private readonly incompleteToolCall = /<tool_call>[\s\S]*$/i;
  private readonly incompleteFunction = /<function=[^>]*>[\s\S]*$/i;

  mightContain(text: string): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    return (
      lower.includes('<use_mcp_tool') ||
      lower.includes('<tool_call') ||
      lower.includes('<function=') ||
      lower.includes('</use_mcp_tool') ||
      lower.includes('</tool_call') ||
      lower.includes('</function')
    );
  }

  parse(text: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];
    
    // 解析 use_mcp_tool
    results.push(...this.parseUseMcpTool(text));
    
    // 解析 tool_call
    results.push(...this.parseToolCall(text));
    
    // 解析 function
    results.push(...this.parseFunction(text));
    
    return results;
  }

  private parseUseMcpTool(text: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];
    const pattern = new RegExp(this.useMcpToolPattern.source, 'gi');
    let match;
    
    while ((match = pattern.exec(text)) !== null) {
      const content = match[1];
      
      // 提取字段
      const serverMatch = /<server_name>([\s\S]*?)<\/server_name>/i.exec(content);
      const toolMatch = /<tool_name>([\s\S]*?)<\/tool_name>/i.exec(content);
      const argsMatch = /<arguments>([\s\S]*?)<\/arguments>/i.exec(content);
      
      const server = serverMatch ? serverMatch[1].trim() : 'unknown';
      const tool = toolMatch ? toolMatch[1].trim() : 'unknown';
      
      let args: Record<string, unknown> | undefined;
      if (argsMatch) {
        try {
          args = JSON.parse(argsMatch[1].trim());
        } catch { /* ignore */ }
      }
      
      results.push({
        server,
        tool,
        args,
        rawText: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        format: 'xml_use_mcp_tool',
        confidence: 0.98,
      });
    }
    
    return results;
  }

  private parseToolCall(text: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];
    const pattern = new RegExp(this.toolCallPattern.source, 'gi');
    let match;
    
    while ((match = pattern.exec(text)) !== null) {
      const content = match[1].trim();
      
      try {
        // 尝试解析 JSON
        const json = JSON.parse(content);
        
        results.push({
          server: json.server || json.serverName || 'unknown',
          tool: json.tool || json.toolName || json.name || 'unknown',
          args: json.args || json.arguments,
          rawText: match[0],
          startIndex: match.index,
          endIndex: match.index + match[0].length,
          format: 'xml_tool_call',
          confidence: 0.95,
        });
      } catch {
        // 如果不是 JSON，尝试其他解析方式
        // 可能是简单的 server.tool 格式
        const parts = content.split(/[.\s]/);
        if (parts.length >= 2) {
          results.push({
            server: parts[0],
            tool: parts[1],
            rawText: match[0],
            startIndex: match.index,
            endIndex: match.index + match[0].length,
            format: 'xml_tool_call',
            confidence: 0.7,
          });
        }
      }
    }
    
    return results;
  }

  private parseFunction(text: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];
    const pattern = new RegExp(this.functionPattern.source, 'gi');
    let match;
    
    while ((match = pattern.exec(text)) !== null) {
      const funcName = match[1].trim();
      const argsStr = match[2].trim();
      
      // 解析函数名
      let server = 'default';
      let tool = funcName;
      
      if (funcName.includes('.')) {
        const parts = funcName.split('.');
        server = parts[0];
        tool = parts.slice(1).join('.');
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
        format: 'xml_function',
        confidence: 0.9,
      });
    }
    
    return results;
  }

  clean(text: string, _options?: CleanOptions): ProcessResult {
    if (!this.mightContain(text)) {
      return { text, toolCalls: [], processed: false };
    }

    let cleaned = text;
    const removedFragments: string[] = [];

    // 移除完整的 use_mcp_tool
    cleaned = cleaned.replace(this.useMcpToolPattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    // 移除完整的 tool_call
    cleaned = cleaned.replace(this.toolCallPattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    // 移除完整的 function
    cleaned = cleaned.replace(this.functionPattern, (match) => {
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

    // 移除不完整的标签
    if (this.incompleteUseMcpTool.test(result)) {
      result = result.replace(this.incompleteUseMcpTool, '');
    }
    if (this.incompleteToolCall.test(result)) {
      result = result.replace(this.incompleteToolCall, '');
    }
    if (this.incompleteFunction.test(result)) {
      result = result.replace(this.incompleteFunction, '');
    }

    // 移除不完整的标签前缀
    const incompletePrefixes = [
      '<use_mcp_tool', '</use_mcp_tool',
      '<tool_call', '</tool_call',
      '<function='
    ];

    for (const prefix of incompletePrefixes) {
      for (let len = prefix.length; len >= 4; len--) {
        const partial = prefix.substring(0, len);
        if (result.endsWith(partial)) {
          result = result.slice(0, -partial.length);
          break;
        }
      }
    }

    return result;
  }
}

