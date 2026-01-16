/**
 * MCP 提示词注入器
 * 
 * ## 重构说明
 * 
 * 此文件已重构为使用统一的注入管理器 (InjectionManager)。
 * 保留原有的导出接口以确保向后兼容性。
 * 
 * ## 核心改进
 * 
 * 1. 使用分层意图检测策略，减少误判
 * 2. 将多条 system 消息合并为少数消息，提高指令清晰度
 * 3. 统一初始调用和追问阶段的注入逻辑
 */

import { InjectionManager } from './injection';

/**
 * 注入结果类型（保持向后兼容）
 */
export type InjectionResult = {
  systemMessages: Array<{ role: 'system'; content: string }>
};

/**
 * 构建 MCP 系统注入
 * 
 * @param content 用户消息内容
 * @param currentConversationId 当前会话 ID
 * @param providerName Provider 名称
 * @returns 注入的 system 消息列表
 * 
 * @example
 * ```typescript
 * const { systemMessages } = await buildMcpSystemInjections(
 *   userMessage,
 *   conversationId,
 *   'openai'
 * );
 * ```
 */
export async function buildMcpSystemInjections(
  content: string, 
  currentConversationId?: string, 
  providerName?: string
): Promise<InjectionResult> {
  const result = await InjectionManager.inject({
    userContent: content,
    conversationId: currentConversationId,
    phase: 'initial',
    providerName
  });
  
  return {
    systemMessages: result.systemMessages
  };
}

/**
 * 检测是否需要 MCP 注入
 * 
 * 用于在调用完整注入之前快速判断是否需要注入。
 * 
 * @param content 用户消息内容
 * @param conversationId 会话 ID
 * @returns 是否需要注入
 */
export function needsMcpInjection(content: string, conversationId?: string): boolean {
  const decision = InjectionManager.detectNeedInjection(content, conversationId);
  return decision.shouldInject;
}

/**
 * 重置会话的注入状态
 * 
 * 在会话重置或清空时调用，清除缓存的注入状态。
 * 
 * @param conversationId 会话 ID
 */
export function resetInjectionState(conversationId: string): void {
  InjectionManager.resetConversationState(conversationId);
}
