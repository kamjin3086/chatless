/**
 * 内容事件处理器（线性委派架构）
 * 
 * ## 职责（单一职责原则）
 * 
 * 1. 接收 content_token 事件
 * 2. 累积原始内容到上下文（用于tool_call解析）
 * 3. 转发给FSM处理
 * 
 * ## 不负责（委派给下游）
 * 
 * - ❌ 内容过滤：由 segments 层负责（`filterToolCallContent`）
 * - ❌ 状态管理：由 FSM 负责
 * - ❌ UI更新：由 FSM → segments → UI 负责
 * 
 * ## 设计理念
 * 
 * 像流水线一样，每个环节只做自己该做的事：
 * ```
 * ContentEventHandler (接收+转发)
 *     ↓
 * FSM (状态管理+路由)
 *     ↓
 * Segments (业务逻辑+过滤)
 *     ↓
 * UI (纯渲染)
 * ```
 */

import type { StreamEvent } from '@/lib/llm/types/stream-events';
import type { EventHandler, StreamContext } from '../types';
import { useChatStore } from '@/store/chatStore';
import { createContentAppender } from '../ContentAppender';
import { createInlineThinkingOrchestrator } from '../thinking';

export class ContentEventHandler implements EventHandler {
  canHandle(event: StreamEvent): boolean {
    return event.type === 'content_token';
  }

  handle(event: StreamEvent, context: StreamContext): void {
    // 输入验证
    if (!event || event.type !== 'content_token') {
      console.warn('[ContentHandler] Invalid event received:', event);
      return;
    }

    if (!context || !context.messageId) {
      console.error('[ContentHandler] Invalid context: missing messageId');
      return;
    }

    const chunk = String(event.content || '');
    if (!chunk) return;

    // 防止内容无限增长（保护措施）
    if (context.content.length > 1000000) { // 1MB 限制
      console.warn('[ContentHandler] Content size limit reached, skipping token');
      return;
    }

    // ⚠️ 【重要】：context.content 保存的是原始未过滤的内容
    // 
    // 用途：
    // 1. 工具调用解析（ToolCallEventHandler）需要完整原始文本
    // 2. 包含被 suppression valve 过滤掉的工具调用指令
    // 3. 用于构建 LLM 历史对话（HistoryBuilder）
    // 
    // 注意：
    // - context.content 不应该用于 UI 渲染或内容判断
    // - UI 应该使用 segments（由 FSM 生成）
    // - 判断是否有文本内容应该使用 segments 而不是 content
    context.content += chunk;

    // —— 早阻断抑制阀（已简化：工具指令抑制由 ToolChannelParser 统一处理） ——
    const visible = applySuppressionValve(context, chunk);
    if (!visible) return;

    // —— Inline thinking 解析（仅当 provider 未提供 thinking_* 事件时启用） ——
    const pieces = splitInlineThinking(context, visible);
    if (pieces.length === 0) return;

    // 让 message.content 在流式期间也能更新（并节流落盘），避免"只有结束才有内容"
    const appender = getContentAppender(context);

    // 转发给FSM处理（带错误处理）
    try {
      const store = useChatStore.getState();
      
      if (!store || typeof store.dispatchMessageAction !== 'function') {
        console.error('[ContentHandler] Invalid store state');
        return;
      }

      for (const p of pieces) {
        if (p.type === 'text') {
          const rawText = String(p.text || '');
          if (rawText) {
            // 注意：为了让 salvage/orchestrator 能"看见"原始的 </think>，TOKEN_APPEND 仍发送 rawText。
            // 但 message.content（用于 UI fallback / early render）不应包含字面量 think 标签，否则会短暂/持续泄漏到正文。
            const visibleText = rawText.replaceAll('</think>', '').replaceAll('<think>', '');

            try {
              if (visibleText) appender.append(visibleText);
            } catch {
              // ignore
            }
            store.dispatchMessageAction(context.messageId, { type: 'TOKEN_APPEND', chunk: rawText });
          }
        } else if (p.type === 'think_start') {
          store.dispatchMessageAction(context.messageId, { type: 'THINK_START' } as any);
        } else if (p.type === 'think_token') {
          const t = String(p.text || '');
          if (t) store.dispatchMessageAction(context.messageId, { type: 'THINK_APPEND', chunk: t } as any);
        } else if (p.type === 'think_end') {
          store.dispatchMessageAction(context.messageId, { type: 'THINK_END' } as any);
        }
      }

    } catch (error) {
      console.error('[ContentHandler] Failed to dispatch action:', error);
      // 不抛出错误，避免中断整个流
    }
  }
}

function getContentAppender(context: StreamContext) {
  const anyCtx = context as any;
  if (anyCtx._contentAppender) return anyCtx._contentAppender as ReturnType<typeof createContentAppender>;
  const st = useChatStore.getState();
  const appender = createContentAppender({
    assistantMessageId: context.messageId,
    updateMessageContentInMemory: st.updateMessageContentInMemory,
    updateMessage: st.updateMessage,
    getCurrentContent: () => {
      try {
        const fresh = useChatStore.getState();
        const conv = fresh.conversations.find((c: any) => c && c.id === context.conversationId);
        const msg: any = conv?.messages?.find((m: any) => m && m.id === context.messageId);
        return String(msg?.content || '');
      } catch {
        return '';
      }
    },
  });
  anyCtx._contentAppender = appender;
  return appender;
}

function splitInlineThinking(context: StreamContext, visibleChunk: string) {
  // 若 provider 已经输出 thinking_* 事件，则不再对正文进行 <think> 解析，避免重复/错乱
  if (context.hasProviderThinking) {
    return [{ type: 'text' as const, text: visibleChunk }];
  }
  const anyCtx = context as any;
  if (!anyCtx._inlineThinking) {
    anyCtx._inlineThinking = createInlineThinkingOrchestrator();
  }
  const parser = anyCtx._inlineThinking as ReturnType<typeof createInlineThinkingOrchestrator>;
  const out = parser.push(visibleChunk);
  return out;
}

/**
 * 早阻断"抑制阀"（已简化）
 * 
 * 重要变更：工具指令抑制已统一由 ToolChannelParser（Provider 层）处理。
 * 此函数现在直接透传内容，不再创建额外的 suppressor 实例。
 * 
 * 这样做是为了避免多个 suppressor 实例导致的状态不一致问题：
 * - 之前 ContentEventHandler 和 ToolChannelParser 各自创建 suppressor
 * - 当内容被分割到不同实例处理时，会导致工具指令识别失败
 * - 现在统一在 ToolChannelParser 层处理，确保单一状态机处理完整的流
 */
function applySuppressionValve(context: StreamContext, chunk: string): string {
  // 保留 context.suppression 字段用于兼容性
  if (!context.suppression) {
    context.suppression = { buffer: '', active: false, braceDepth: 0, seenJsonStart: false, guardWindow: 64 };
  }
  
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/9f8e7fe1-428e-4909-b4e4-b7238838d737',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ContentEventHandler.ts:applySuppressionValve',message:'passthrough (suppression moved to ToolChannelParser)',data:{chunkPreview:chunk.slice(0,100)},timestamp:Date.now(),hypothesisId:'G'})}).catch(()=>{});
  // #endregion
  
  // 直接返回原始 chunk，工具指令抑制由 ToolChannelParser 在 Provider 层统一处理
  return chunk;
}
