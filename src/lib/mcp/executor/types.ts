/**
 * 工具执行器相关类型定义
 */

import type { Message as LlmMessage } from '@/lib/llm/types';

/**
 * 工具调用参数
 */
export interface ToolCallParams {
  assistantMessageId: string;
  conversationId: string;
  server: string;
  tool: string;
  args?: Record<string, unknown>;
  provider: string;
  model: string;
  historyForLlm: LlmMessage[];
  originalUserContent: string;
  cardId?: string;
}

/**
 * 工具调用结果
 */
export interface ToolCallResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * 工具执行器接口
 */
export interface IToolExecutor {
  /**
   * 执行工具调用
   */
  execute(): Promise<void>;
}

