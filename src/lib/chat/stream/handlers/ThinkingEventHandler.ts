/**
 * 思考事件处理器
 * 
 * 职责：
 * - 处理 thinking_start、thinking_token、thinking_end 事件
 * - 更新思考状态和内容
 * - 派发 FSM 动作到状态管理器
 */

import type { StreamEvent } from '@/lib/llm/types/stream-events';
import type { EventHandler, StreamContext } from '../types';
import { useChatStore } from '@/store/chatStore';

export class ThinkingEventHandler implements EventHandler {
  canHandle(event: StreamEvent): boolean {
    return event.type === 'thinking_start' 
        || event.type === 'thinking_token' 
        || event.type === 'thinking_end';
  }

  handle(event: StreamEvent, context: StreamContext): void {
    // 输入验证
    if (!event || !event.type) {
      console.warn('[ThinkingHandler] Invalid event received:', event);
      return;
    }

    if (!context || !context.messageId) {
      console.error('[ThinkingHandler] Invalid context: missing messageId');
      return;
    }

    try {
      const store = useChatStore.getState();
      
      if (!store || typeof store.dispatchMessageAction !== 'function') {
        console.error('[ThinkingHandler] Invalid store state');
        return;
      }

      switch (event.type) {
        case 'thinking_start':
          context.thinkingStartTime = Date.now();
          context.fsmState = 'RENDERING_THINK';
          context.hasProviderThinking = true;
          store.dispatchMessageAction(context.messageId, { type: 'THINK_START' });
          break;

        case 'thinking_token':
          // 验证内容存在
          if (event.content && typeof event.content === 'string') {
            store.dispatchMessageAction(context.messageId, { 
              type: 'THINK_APPEND', 
              chunk: event.content 
            });
          }
          break;

        case 'thinking_end':
          // 状态一致性检查
          if (context.fsmState !== 'RENDERING_THINK') {
            console.warn('[ThinkingHandler] Unexpected THINK_END without THINK_START');
          }
          context.fsmState = 'RENDERING_BODY';
          store.dispatchMessageAction(context.messageId, { type: 'THINK_END' });
          break;
      }
    } catch (error) {
      console.error('[ThinkingHandler] Failed to handle event:', error);
      // 不抛出错误，避免中断整个流
    }
  }
}

