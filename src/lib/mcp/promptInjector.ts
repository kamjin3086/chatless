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
 * 4. 支持原生工具调用 API
 */

import { InjectionManager } from './injection';
import type {
  InjectionResult as FullInjectionResult,
  NativeToolDefinition,
} from './injection/types';
import type { PromptBlock } from './prompt/composition';

/**
 * 注入结果类型（扩展版，支持原生工具调用）
 */
export interface InjectionResult {
  /** Prompt blocks; the agent envelope merges them into one system message. */
  systemMessages: PromptBlock[];
  /** 是否应该使用原生工具调用 API */
  useNativeTools?: boolean;
  /** 原生工具定义列表（当 useNativeTools=true 时使用） */
  nativeTools?: NativeToolDefinition[];
  /** 启用的服务器列表 */
  enabledServers?: string[];
}

/**
 * 构建 MCP 系统注入
 * 
 * @param content 用户消息内容
 * @param currentConversationId 当前会话 ID
 * @param providerName Provider 名称
 * @param modelName 模型名称（用于检测工具调用能力）
 * @returns 注入的 system 消息列表和工具定义
 * 
 * @example
 * ```typescript
 * const { systemMessages, useNativeTools, nativeTools } = await buildMcpSystemInjections(
 *   userMessage,
 *   conversationId,
 *   'openai',
 *   'gpt-4'
 * );
 * ```
 */
export async function buildMcpSystemInjections(
  content: string, 
  currentConversationId?: string, 
  providerName?: string,
  modelName?: string,
  options?: { forceInject?: boolean; locale?: string; planOnly?: boolean }
): Promise<InjectionResult> {
  const result = await InjectionManager.inject({
    userContent: content,
    conversationId: currentConversationId,
    phase: 'initial',
    providerName,
    modelName,
    forceInject: options?.forceInject,
    locale: options?.locale,
    planOnly: options?.planOnly,
  });
  
  return {
    systemMessages: result.systemMessages,
    useNativeTools: result.useNativeTools,
    nativeTools: result.nativeTools,
    enabledServers: result.enabledServers,
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
