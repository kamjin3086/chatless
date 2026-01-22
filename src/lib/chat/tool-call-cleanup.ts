/**
 * 工具调用内容清理工具
 * 
 * ## 重构说明
 * 
 * 此模块现在委托给 `@/lib/mcp/toolInstruction` 模块，
 * 使用统一的 Pipeline 架构进行处理。
 * 
 * 负责从消息内容中移除工具调用指令，确保用户只看到工具卡片而不是原始指令
 */

import { 
  filterForPersist, 
  detectToolInstruction,
  getDefaultPipeline 
} from "../mcp/toolInstruction";

// #region agent log
const DEBUG_LOG_ENDPOINT = 'http://127.0.0.1:7244/ingest/9f8e7fe1-428e-4909-b4e4-b7238838d737';
function debugLog(location: string, message: string, data?: unknown, hypothesisId?: string) {
  fetch(DEBUG_LOG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      location,
      message,
      data,
      timestamp: Date.now(),
      sessionId: 'debug-session',
      runId: 'weather-leakage',
      hypothesisId,
    }),
  }).catch(() => {});
}
// #endregion

/**
 * 清理文本中的所有工具调用指令
 * 
 * @param text 要清理的文本
 * @returns 清理后的文本
 */
export function cleanToolCallInstructions(text: string): string {
  if (!text) return '';
  const cleaned = filterForPersist(text);
  // #region agent log
  if (/\b(web_search|eb_search)\b/i.test(text) || /commentary\s+to=/i.test(text) || /<use_mcp_tool|<tool_call/i.test(text)) {
    debugLog(
      'tool-call-cleanup.ts:H2-clean',
      'cleanToolCallInstructions (persist) applied',
      {
        rawLen: text.length,
        cleanedLen: cleaned.length,
        cleanedIsEmptyAfterTrim: cleaned.trim().length === 0,
        rawSample: text.slice(0, 240),
        cleanedSample: cleaned.slice(0, 240),
      },
      'H2'
    );
  }
  // #endregion
  return cleaned;
}

/**
 * 从文本中提取工具调用指令（不清理文本）
 * 
 * 使用统一的 Pipeline 架构进行解析
 * 
 * @param text 要解析的文本
 * @returns 解析出的工具调用信息，如果没有则返回 null
 */
export function extractToolCallFromText(
  text: string
): null | { server: string; tool: string; args?: Record<string, unknown> } {
  if (!text) return null;
  
  try {
    // 使用新的 Pipeline 架构
    const pipeline = getDefaultPipeline();
    const parsed = pipeline.parseFirst(text);
    
    if (parsed) {
      // #region agent log
      if (/\b(web_search|eb_search)\b/i.test(text) || /commentary\s+to=/i.test(text) || /<use_mcp_tool|<tool_call/i.test(text)) {
        debugLog(
          'tool-call-cleanup.ts:H1-parseFirst',
          'pipeline.parseFirst succeeded',
          {
            server: parsed.server,
            tool: parsed.tool,
            hasArgs: !!parsed.args,
            rawSample: text.slice(0, 240),
          },
          'H1'
        );
      }
      // #endregion
      return {
        server: parsed.server,
        tool: parsed.tool,
        args: parsed.args,
      };
    }
  } catch (e) {
    console.warn('[extractToolCallFromText] Pipeline 解析失败，使用降级逻辑:', e);
    
    // 降级：使用旧的检测器
    const result = detectToolInstruction(text);
    if (result.detected && result.server && result.tool) {
      // #region agent log
      debugLog(
        'tool-call-cleanup.ts:H1-fallback',
        'detectToolInstruction fallback succeeded',
        { server: result.server, tool: result.tool, hasArgs: !!result.args, rawSample: text.slice(0, 240) },
        'H1'
      );
      // #endregion
      return {
        server: result.server,
        tool: result.tool,
        args: result.args,
      };
    }
  }
  
  // #region agent log
  if (/\b(web_search|eb_search)\b/i.test(text) || /commentary\s+to=/i.test(text) || /<use_mcp_tool|<tool_call/i.test(text)) {
    debugLog(
      'tool-call-cleanup.ts:H3-noParse',
      'No tool call parsed from text',
      { rawLen: text.length, rawSample: text.slice(0, 240) },
      'H3'
    );
  }
  // #endregion
  return null;
}

/**
 * 从文本中提取**所有**工具调用指令（不清理文本）
 *
 * 说明：之前只用 parseFirst 会导致“多城市天气”这类一次输出多次工具调用时，
 * 只执行第一个工具，后续工具全部丢失。
 */
export function extractToolCallsFromText(
  text: string
): Array<{ server: string; tool: string; args?: Record<string, unknown> }> {
  if (!text) return [];
  try {
    const pipeline = getDefaultPipeline();
    const parsedAll = pipeline.parseAll(text);
    const valid = parsedAll.filter((c) => {
      const server = String(c.server || '');
      const tool = String(c.tool || '');
      if (!server || server === 'unknown' || server.includes('use_mcp_tool') || server.includes('>')) return false;
      if (!tool || tool === 'unknown' || tool === 'default') return false;

      // web_search 需要 query，否则会形成“空工具卡片/空调用”
      if (server === 'web_search') {
        const q = (c.args as any)?.query;
        if (typeof q !== 'string' || q.trim().length === 0) return false;
      }
      return true;
    });

    // #region agent log
    if (/\b(web_search|eb_search)\b/i.test(text) || /commentary\s+to=/i.test(text) || /<use_mcp_tool|<tool_call/i.test(text)) {
      debugLog(
        'tool-call-cleanup.ts:H1-parseAll',
        'pipeline.parseAll extracted calls',
        {
          rawLen: text.length,
          parsedCount: parsedAll.length,
          validCount: valid.length,
          validPreview: valid.slice(0, 6),
          rawSample: text.slice(0, 240),
        },
        'H1'
      );
    }
    // #endregion

    const stableArgsKey = (args: any) => {
      if (!args || typeof args !== 'object') return '';
      try {
        const keys = Object.keys(args).sort();
        const obj: Record<string, unknown> = {};
        for (const k of keys) obj[k] = args[k];
        return JSON.stringify(obj);
      } catch {
        return '';
      }
    };

    // 去重：同一段文本会被 gpt_oss_channel + gpt_oss_commentary 同时命中，导致重复 tool_call 事件
    const seen = new Set<string>();
    const unique = [];
    for (const c of valid) {
      const key = `${c.server}.${c.tool}:${stableArgsKey(c.args)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(c);
    }

    return unique.map((c) => ({ server: c.server, tool: c.tool, args: c.args }));
  } catch (e) {
    console.warn('[extractToolCallsFromText] Pipeline 解析失败:', e);
    return [];
  }
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

