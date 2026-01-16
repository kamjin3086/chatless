/**
 * 工具卡片标记工具
 * 
 * ## 设计目标
 * 
 * 提供创建和识别工具卡片标记的统一接口。
 */

import type { ToolCallStatus } from '../../chat/segments';

/**
 * 工具卡片标记接口
 */
export interface ToolCardMarker {
  __tool_call_card__: {
    id: string;
    server: string;
    tool: string;
    status: ToolCallStatus;
    args: Record<string, unknown>;
    messageId: string;
  };
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
  const marker: ToolCardMarker = {
    __tool_call_card__: {
      id: cardId,
      server,
      tool,
      status: 'running',
      args: args || {},
      messageId
    }
  };
  return JSON.stringify(marker);
}

/**
 * 检查文本是否包含工具卡片标记
 */
export function hasToolCardMarker(text: string): boolean {
  return text.includes('"__tool_call_card__"');
}

/**
 * 从文本中提取工具卡片标记
 */
export function extractToolCardMarker(text: string): ToolCardMarker | null {
  const match = text.match(/\{[^}]*"__tool_call_card__"[^}]*\}/);
  if (!match) return null;
  
  try {
    return JSON.parse(match[0]) as ToolCardMarker;
  } catch {
    return null;
  }
}

