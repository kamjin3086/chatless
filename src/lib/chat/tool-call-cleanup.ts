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

/**
 * 清理文本中的所有工具调用指令
 * 
 * @param text 要清理的文本
 * @returns 清理后的文本
 */
export function cleanToolCallInstructions(text: string): string {
  if (!text) return '';
  return filterForPersist(text);
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
      return {
        server: result.server,
        tool: result.tool,
        args: result.args,
      };
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

