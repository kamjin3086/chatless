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
import { createToolInstructionSuppressor } from '../toolInstructionSuppressor';
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

    // —— 早阻断抑制阀（稳定版，状态机） ——
    const visible = applySuppressionValve(context, chunk);
    if (!visible) return;

    // —— Inline thinking 解析（仅当 provider 未提供 thinking_* 事件时启用） ——
    const pieces = splitInlineThinking(context, visible);
    if (pieces.length === 0) return;

    // 让 message.content 在流式期间也能更新（并节流落盘），避免“只有结束才有内容”
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
          const t = String(p.text || '');
          if (t) {
            try {
              appender.append(t);
            } catch {
              // ignore
            }
            store.dispatchMessageAction(context.messageId, { type: 'TOKEN_APPEND', chunk: t });
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
  return parser.push(visibleChunk);
}

/**
 * 早阻断“抑制阀”（稳定版）
 * - 使用共享状态机，避免“猜测式截断”误伤普通文本（尤其是 HTML/代码里的 "<"）
 * - 支持 XML 闭合标签与 JSON 大括号闭合
 */
function applySuppressionValve(context: StreamContext, chunk: string): string {
  // 在 context.suppression 上复用字段，保证 Orchestrator 的“尾巴冲刷”逻辑仍然可用
  const anyCtx = context as any;
  if (!anyCtx._toolSuppressor) {
    anyCtx._toolSuppressor = createToolInstructionSuppressor({ guardWindow: 64, maxBuffer: 65536 });
  }
  const sup = anyCtx._toolSuppressor as ReturnType<typeof createToolInstructionSuppressor>;
  const up = sup.push(chunk);

  // 同步给旧字段（仅用于冲刷尾部窗口）
  if (!context.suppression) {
    context.suppression = { buffer: '', active: false, braceDepth: 0, seenJsonStart: false, guardWindow: 64 };
  }
  context.suppression.buffer = ''; // 由 suppressor 自己维护 buffer；这里仅保留“可冲刷尾巴”的语义
  context.suppression.active = sup.getState().active;
  context.suppression.guardWindow = 64;

  if (up.started) {
    try { useChatStore.getState().dispatchMessageAction(context.messageId, { type: 'TOOL_DETECTING_START' } as any); } catch { /* noop */ }
  }
  if (up.ended) {
    try { useChatStore.getState().dispatchMessageAction(context.messageId, { type: 'TOOL_DETECTING_END' } as any); } catch { /* noop */ }
  }
  return up.visible || '';
}

