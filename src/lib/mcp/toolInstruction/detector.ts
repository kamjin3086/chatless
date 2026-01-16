/**
 * 工具指令检测器
 * 
 * ## 设计目标
 * 
 * 从文本中检测和提取工具调用指令信息。
 * 
 * ## 功能
 * 
 * 1. **检测**: 判断文本是否包含工具调用指令
 * 2. **提取**: 从文本中解析出服务器、工具、参数等信息
 * 3. **分类**: 识别指令格式类型
 */

import { 
  type ToolInstructionFormat,
  mightContainToolInstruction
} from './patterns';
import { WEB_SEARCH_SERVER_NAME } from '../nativeTools/webSearch';

/**
 * 检测结果
 */
export interface DetectionResult {
  /** 是否检测到工具调用 */
  detected: boolean;
  /** 指令格式类型 */
  format?: ToolInstructionFormat;
  /** 服务器名称 */
  server?: string;
  /** 工具名称 */
  tool?: string;
  /** 工具参数 */
  args?: Record<string, unknown>;
  /** 原始匹配文本 */
  rawMatch?: string;
}

/**
 * 检测文本中是否包含工具调用指令
 */
export function detectToolInstruction(text: string): DetectionResult {
  if (!text || !mightContainToolInstruction(text)) {
    return { detected: false };
  }
  
  // 按优先级尝试各种格式
  const parsers: Array<() => DetectionResult | null> = [
    () => parseXmlUseMcpTool(text),
    () => parseXmlToolCall(text),
    () => parseGptOss(text),
    () => parseFunctionLike(text),
    () => parseSeparatorStyle(text),
    () => parseJsonToolCall(text),
  ];
  
  for (const parser of parsers) {
    const result = parser();
    if (result && result.detected) {
      return result;
    }
  }
  
  return { detected: false };
}

/**
 * 解析 <use_mcp_tool> 格式
 */
function parseXmlUseMcpTool(text: string): DetectionResult | null {
  const match = text.match(/<use_mcp_tool>([\s\S]*?)<\/use_mcp_tool>/i);
  if (!match || !match[1]) return null;
  
  try {
    const block = match[1];
    const serverMatch = block.match(/<server_name[^>]*>([\s\S]*?)<\/server_name>/i);
    const toolMatch = block.match(/<tool_name[^>]*>([\s\S]*?)<\/tool_name>/i);
    const argsMatch = block.match(/<arguments[^>]*>([\s\S]*?)<\/arguments>/i);
    
    const server = (serverMatch?.[1] || '').trim();
    const tool = (toolMatch?.[1] || '').trim();
    
    let args: Record<string, unknown> | undefined;
    if (argsMatch?.[1]) {
      const inside = argsMatch[1].trim();
      // 移除可能的代码围栏
      const fenced = inside.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '');
      const start = fenced.indexOf('{');
      const end = fenced.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        try {
          args = JSON.parse(fenced.slice(start, end + 1));
        } catch { /* ignore */ }
      }
    }
    
    if (server && tool) {
      return {
        detected: true,
        format: 'xml_use_mcp_tool',
        server,
        tool,
        args,
        rawMatch: match[0]
      };
    }
  } catch { /* ignore */ }
  
  return null;
}

/**
 * 解析 <tool_call> 格式
 */
function parseXmlToolCall(text: string): DetectionResult | null {
  const match = text.match(/<tool_call>([\s\S]*?)<\/tool_call>/i);
  if (!match || !match[1]) return null;
  
  try {
    const obj = JSON.parse(match[1]);
    const server = obj.server || obj.mcp || obj.provider;
    const tool = obj.tool || obj.tool_name || obj.name;
    if (server && tool) {
      return {
        detected: true,
        format: 'xml_tool_call',
        server,
        tool,
        args: obj.parameters || obj.args || obj.params,
        rawMatch: match[0]
      };
    }
  } catch { /* ignore */ }
  
  return null;
}

/**
 * 解析 GPT-OSS / commentary 格式
 */
function parseGptOss(text: string): DetectionResult | null {
  const idxComm = text.search(/commentary\s+to=/i);
  if (idxComm < 0) return null;
  
  try {
    let after = text.slice(idxComm);
    const eqIdx = after.toLowerCase().indexOf('to=');
    if (eqIdx >= 0) {
      after = after.slice(eqIdx + 3);
    }
    
    // 取第一个非空白、非 '<' 的 token 作为目标
    const targetMatch = after.match(/^\s*([^\s<]+)/);
    const toTargetRaw = targetMatch ? targetMatch[1].trim() : '';
    
    // 提取 JSON 参数
    const jsonStr = extractFirstJsonObject(after);
    let args: Record<string, unknown> | undefined;
    if (jsonStr) {
      try { args = JSON.parse(jsonStr); } catch { /* ignore */ }
    }
    
    if (toTargetRaw) {
      let server = '';
      let tool = '';
      
      if (toTargetRaw.includes('.')) {
        const dot = toTargetRaw.indexOf('.');
        server = toTargetRaw.slice(0, dot).trim();
        tool = toTargetRaw.slice(dot + 1).trim().replace(/\s+/g, '_');
      } else {
        server = toTargetRaw.trim();
      }
      
      // 兼容误写形式：to=web_fetch -> web_search.fetch
      if (!tool && server === 'web_fetch') {
        server = WEB_SEARCH_SERVER_NAME;
        tool = 'fetch';
      }
      
      // web_search 无工具名时，根据参数推断
      if (server === WEB_SEARCH_SERVER_NAME && !tool) {
        const hasQuery = args && typeof (args as Record<string, unknown>).query === 'string' && 
          String((args as Record<string, unknown>).query).trim().length > 0;
        const hasUrl = args && typeof (args as Record<string, unknown>).url === 'string' && 
          String((args as Record<string, unknown>).url).trim().length > 0;
        if (hasUrl && !hasQuery) tool = 'fetch';
        else tool = 'search';
      }
      
      if (server && tool) {
        return {
          detected: true,
          format: 'gpt_oss',
          server,
          tool,
          args
        };
      }
    }
  } catch { /* ignore */ }
  
  return null;
}

/**
 * 解析函数式格式：server.tool {...}
 */
function parseFunctionLike(text: string): DetectionResult | null {
  const match = /(?:^|\s)([a-z0-9_]+)\.([a-z0-9_]+)\s*\{/i.exec(text);
  if (!match) return null;
  
  try {
    const left = (match[1] || '').trim();
    const right = (match[2] || '').trim();
    const pos = match.index !== undefined ? (match.index + match[0].length - 1) : -1;
    
    if (pos >= 0) {
      const objStr = extractFirstJsonObject(text.slice(pos));
      if (objStr) {
        const args = JSON.parse(objStr);
        // 将 "search.search" 视为 web_search.search
        const server = left === 'search' ? WEB_SEARCH_SERVER_NAME : left;
        
        if (server && right) {
          return {
            detected: true,
            format: 'function_like',
            server,
            tool: right,
            args
          };
        }
      }
    }
  } catch { /* ignore */ }
  
  return null;
}

/**
 * 解析分隔符格式：to=>>server>>tool>>{...}>>
 */
function parseSeparatorStyle(text: string): DetectionResult | null {
  const match = /to\s*=\s*>+([a-z0-9_-]+)>+([a-z0-9_-]+)>+\s*/i.exec(text);
  if (!match) return null;
  
  try {
    const server = match[1];
    const tool = match[2].replace(/\s+/g, '_');
    const pos = match.index !== undefined ? (match.index + match[0].length) : -1;
    
    if (server && tool && pos >= 0) {
      const jsonStr = extractFirstJsonObject(text.slice(pos));
      if (jsonStr) {
        const args = JSON.parse(jsonStr);
        return {
          detected: true,
          format: 'separator_style',
          server,
          tool,
          args
        };
      }
    }
  } catch { /* ignore */ }
  
  return null;
}

/**
 * 解析 JSON 格式
 */
function parseJsonToolCall(text: string): DetectionResult | null {
  const match = text.match(/\{[\s\S]*?"type"\s*:\s*"tool_call"[\s\S]*?\}/i);
  if (!match) return null;
  
  try {
    const obj = JSON.parse(match[0]);
    const server = obj.server || obj.mcp || obj.provider;
    const tool = obj.tool || obj.tool_name || obj.name;
    if (server && tool) {
      return {
        detected: true,
        format: 'json_tool_call',
        server,
        tool,
        args: obj.parameters || obj.args || obj.params,
        rawMatch: match[0]
      };
    }
  } catch { /* ignore */ }
  
  return null;
}

/**
 * 从字符串中提取第一个 JSON 对象
 */
function extractFirstJsonObject(s: string): string | null {
  let depth = 0;
  let start = -1;
  
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') {
      if (start === -1) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) depth--;
      if (depth === 0 && start !== -1) {
        return s.slice(start, i + 1);
      }
    }
  }
  
  return null;
}

