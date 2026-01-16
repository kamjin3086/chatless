/**
 * 工具调用内容清理工具
 * 
 * ## 重构说明
 * 
 * 此模块现在委托给 `@/lib/mcp/toolInstruction` 模块，
 * 使用统一的模式定义进行清理。
 * 
 * 负责从消息内容中移除工具调用指令，确保用户只看到工具卡片而不是原始指令
 */

import { WEB_SEARCH_SERVER_NAME } from "../mcp/nativeTools/webSearch";

/**
 * 清理文本中的所有工具调用指令
 * 
 * @param text 要清理的文本
 * @returns 清理后的文本
 */
export function cleanToolCallInstructions(text: string): string {
  if (!text) return '';
  
  // 使用统一的工具指令过滤模块
  try {
    const { filterForPersist } = require('@/lib/mcp/toolInstruction');
    return filterForPersist(text);
  } catch {
    // 降级：使用简化的本地过滤逻辑
    return fallbackClean(text);
  }
}

/**
 * 降级清理函数（当模块加载失败时使用）
 */
function fallbackClean(text: string): string {
  let cleaned = text;
  
  // 移除完整的 XML 指令块
  cleaned = cleaned.replace(/<use_mcp_tool>[\s\S]*?<\/use_mcp_tool>/gi, '');
  cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
  
  // 移除 JSON 格式的工具调用
  cleaned = cleaned.replace(/\{[\s\S]*?"type"\s*:\s*"tool_call"[\s\S]*?\}/gi, '');
  
  // 移除内部标记
  cleaned = cleaned.replace(/\{[^}]*"__tool_call_card__"[^}]*\}/g, '');
  
  // 清理多余空行
  cleaned = cleaned.replace(/\n\n\n+/g, '\n\n').trim();
  
  return cleaned;
}

/**
 * 从文本中提取工具调用指令（不清理文本）
 * 
 * @param text 要解析的文本
 * @returns 解析出的工具调用信息，如果没有则返回 null
 */
export function extractToolCallFromText(
  text: string
): null | { server: string; tool: string; args?: Record<string, unknown> } {
  if (!text) return null;
  
  // 0. 解析 GPT-OSS 风格：commentary to=server[.tool] ... {json}
  //
  // 统一处理以下多种变体：
  // - <|channel|>commentary to=web_search.fetch <|constrain|>json<|message|>{...}
  // - <|channel|>commentary to=web_search.fetch <|message|>{...}
  // - commentary to=web_search.fetch json {...}
  // - commentary to=web_search code<|message|>{...}
  //
  // 解析规则：
  // 1) 找到 "commentary to=" 之后第一个非空白、非'<' 的连续片段，作为 target（如 "web_search.fetch" 或 "web_search"）
  // 2) 在该位置之后提取第一个 JSON 对象作为 args
  // 3) target 形如 "srv.tool" 时拆分为 server/tool；只有 "srv" 时：
  //    - 若 srv === web_search：根据 args.url / args.query 推断为 fetch 或 search
  //    - 若 srv === web_fetch：视为 web_search.fetch
  try {
    const idxComm = text.search(/commentary\s+to=/i);
    if (idxComm >= 0) {
      // 从 "commentary to=" 之后开始解析
      let after = text.slice(idxComm);
      const eqIdx = after.toLowerCase().indexOf('to=');
      if (eqIdx >= 0) {
        after = after.slice(eqIdx + 3); // 跳过 "to="
      }
      // 取第一个非空白、非'<'的 token 作为目标
      const targetMatch = after.match(/^\s*([^\s<]+)/);
      const toTargetRaw = targetMatch ? targetMatch[1].trim() : '';

      // 从当前位置起提取 JSON
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

        // 兼容误写形式：to=web_fetch -> 等价于 web_search.fetch
        if (!tool && server === 'web_fetch') {
          server = WEB_SEARCH_SERVER_NAME;
          tool = 'fetch';
        }

        // web_search 无工具名时，根据参数推断 search / fetch
        if (server === WEB_SEARCH_SERVER_NAME && !tool) {
          const hasQuery = args && typeof (args as any).query === 'string' && String((args as any).query).trim().length > 0;
          const hasUrl = args && typeof (args as any).url === 'string' && String((args as any).url).trim().length > 0;
          if (hasUrl && !hasQuery) tool = 'fetch';
          else tool = 'search';
        }

        if (server && tool) {
          return { server, tool, args };
        }
      }
    }
  } catch { /* ignore */ }

  // 0.5 解析"函数式变体"：如 "search.search {...}" 或 "filesystem.list_directory {...}"
  try {
    const fnLike = /(?:^|\s)([a-z0-9_]+)\.([a-z0-9_]+)\s*\{/i.exec(text);
    if (fnLike) {
      const left = (fnLike[1] || '').trim();   // 可能是 server 或简写
      const right = (fnLike[2] || '').trim();  // 工具名
      const pos = fnLike.index !== undefined ? (fnLike.index + fnLike[0].length - 1) : -1;
      if (pos >= 0) {
        const objStr = extractFirstJsonObject(text.slice(pos));
        if (objStr) {
          try {
            const args = JSON.parse(objStr);
            // 将 "search.search" 视为 web_search.search；其他情况优先按左值作为 server
            const server = left === 'search' ? WEB_SEARCH_SERVER_NAME : left;
            const tool = right;
            if (server && tool) {
              return { server, tool, args };
            }
          } catch { /* ignore */ }
        }
      }
    }
  } catch { /* ignore */ }

  // 1. 尝试解析 <tool_call> XML 格式
  const xmlMatch = text.match(/<tool_call>([\s\S]*?)<\/tool_call>/i);
  if (xmlMatch && xmlMatch[1]) {
    try {
      const obj = JSON.parse(xmlMatch[1]);
      const server = obj.server || obj.mcp || obj.provider;
      const tool = obj.tool || obj.tool_name || obj.name;
      if (server && tool) {
        return {
          server,
          tool,
          args: obj.parameters || obj.args || obj.params
        };
      }
    } catch { /* ignore */ }
  }
  
  // 2. 尝试解析 <use_mcp_tool> 格式
  const useMatch = text.match(/<use_mcp_tool>([\s\S]*?)<\/use_mcp_tool>/i);
  if (useMatch && useMatch[1]) {
    try {
      const block = useMatch[1];
      const mServer = block.match(/<server_name[^>]*>([\s\S]*?)<\/server_name>/i);
      const mTool = block.match(/<tool_name[^>]*>([\s\S]*?)<\/tool_name>/i);
      const mArgs = block.match(/<arguments[^>]*>([\s\S]*?)<\/arguments>/i);
      
      const server = (mServer?.[1] || '').trim();
      const tool = (mTool?.[1] || '').trim();
      
      let args: Record<string, unknown> | undefined = undefined;
      if (mArgs && mArgs[1]) {
        const inside = mArgs[1].trim();
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
        return { server, tool, args };
      }
    } catch { /* ignore */ }
  }
  
  // 2.5 解析">>"分隔符极简变体：to= >>server>>tool>>{...}>>
  try {
    const simple = /to\s*=\s*>+([a-z0-9_\-]+)>+([a-z0-9_\-]+)>+\s*/i.exec(text);
    if (simple) {
      const server = simple[1];
      const tool = simple[2].replace(/\s+/g, '_');
      const pos = simple.index !== undefined ? (simple.index + simple[0].length) : -1;
      if (server && tool && pos >= 0) {
        const jsonStr = extractFirstJsonObject(text.slice(pos));
        if (jsonStr) {
          try {
            const args = JSON.parse(jsonStr);
            return { server, tool, args };
          } catch { /* ignore */ }
        }
      }
    }
  } catch { /* ignore */ }
  
  // 3. 尝试解析裸 JSON 格式
  try {
    const jsonMatch = text.match(/\{[\s\S]*?"type"\s*:\s*"tool_call"[\s\S]*?\}/i);
    if (jsonMatch && jsonMatch[0]) {
      const obj = JSON.parse(jsonMatch[0]);
      const server = obj.server || obj.mcp || obj.provider;
      const tool = obj.tool || obj.tool_name || obj.name;
      if (server && tool) {
        return {
          server,
          tool,
          args: obj.parameters || obj.args || obj.params
        };
      }
    }
  } catch { /* ignore */ }
  
  return null;
}

/**
 * 从给定字符串开头提取第一个 JSON 对象（基于括号深度匹配）
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

/**
 * 创建工具调用卡片标记
 * 
 * @param cardId 卡片唯一标识
 * @param server 服务器名称
 * @param tool 工具名称
 * @param args 工具参数
 * @param messageId 消息ID
 * @returns JSON 字符串标记
 */
export function createToolCardMarker(
  cardId: string,
  server: string,
  tool: string,
  args: Record<string, unknown> | undefined,
  messageId: string
): string {
  return JSON.stringify({
    __tool_call_card__: {
      id: cardId,
      server,
      tool,
      status: 'running' as const,
      args: args || {},
      messageId
    }
  });
}

