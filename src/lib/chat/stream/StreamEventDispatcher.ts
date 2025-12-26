import { useChatStore } from '@/store/chatStore';
import { createContentAppender } from './ContentAppender';
import { handleToolCall } from './ToolCardService';
import { trace } from '@/lib/debug/Trace';
import { extractToolCallFromText } from '@/lib/chat/tool-call-cleanup';
import { createToolInstructionSuppressor } from './toolInstructionSuppressor';

export type AnyStreamEvent = {
  type: string;
  content?: string;
  parsed?: any;
};

export interface StreamEventDispatcherOptions {
  conversationId: string;
  assistantMessageId: string;
  onAutoExecuteTool?: (server: string, tool: string, args: Record<string, unknown> | undefined, cardId: string) => void | Promise<void>;
  onRequestAuthorization?: (info: { server: string; tool: string; args: Record<string, unknown> | undefined; cardId: string }) => void | Promise<void>;
}

export interface StreamEventDispatcher {
  handle: (event: AnyStreamEvent) => void;
  flush: () => void;
  getState: () => { hadText: boolean; pendingTool?: { server: string; tool: string; cardId: string } | null };
}

export function createStreamEventDispatcher(opts: StreamEventDispatcherOptions): StreamEventDispatcher {
  const st = useChatStore.getState();
  const getCurContent = (): string => {
    const conv = st.conversations.find(c=>c.id===opts.conversationId);
    const msg = conv?.messages.find(m=>m.id===opts.assistantMessageId);
    return (msg?.content || '') + '';
  };
  const appender = createContentAppender({
    assistantMessageId: opts.assistantMessageId,
    updateMessageContentInMemory: st.updateMessageContentInMemory,
    updateMessage: st.updateMessage,
    getCurrentContent: getCurContent
  });
  let hadText = false;
  let pending: null | { server: string; tool: string; cardId: string } = null;
  let contentChars = 0;
  const eventCounts: Record<string, number> = Object.create(null);
  // 抑制阀（稳定版）：追问/降级链路也要启用，避免指令短暂暴露
  const suppressor = createToolInstructionSuppressor({ guardWindow: 64, maxBuffer: 65536 });
  // 工具指令检测缓冲（用于函数式/GPT-OSS 变体的兜底识别）
  let detectBuf = '';

  function applySuppressionValveLocal(chunk: string): string {
    const up = suppressor.push(chunk);
    if (up.started) {
      try { useChatStore.getState().dispatchMessageAction(opts.assistantMessageId, { type: 'TOOL_DETECTING_START' } as any); } catch { /* noop */ }
    }
    if (up.ended) {
      try { useChatStore.getState().dispatchMessageAction(opts.assistantMessageId, { type: 'TOOL_DETECTING_END' } as any); } catch { /* noop */ }
      // 在抑制结束时解析被吞掉的文本，直接触发工具卡插入（兜底）
      try {
        const cap = up.captured || '';
        const parsed = extractToolCallFromText(cap);
        if (parsed && parsed.server && parsed.tool) {
          void handleToolCallInternal({ server: parsed.server, tool: parsed.tool, arguments: parsed.args });
        }
      } catch { /* noop */ }
    }
    return up.visible || '';
  }

  const handleToolCallInternal = async (parsed: any) => {
    if (pending) return;
    const server = parsed.serverName || parsed.server || '';
    const tool = parsed.toolName || parsed.tool || '';
    if (!server || !tool) return;
    const cardId = crypto.randomUUID();
    pending = { server, tool, cardId };
    trace('events', opts.assistantMessageId, `tool_call -> ${server}.${tool}`);
    await handleToolCall({
      conversationId: opts.conversationId,
      assistantMessageId: opts.assistantMessageId,
      parsed,
      onAutoExecute: opts.onAutoExecuteTool,
      onRequestAuthorization: opts.onRequestAuthorization
    });
  };

  return {
    handle: (event: AnyStreamEvent) => {
      const stx = useChatStore.getState();
      eventCounts[event?.type || 'unknown'] = (eventCounts[event?.type || 'unknown'] || 0) + 1;
      switch (event?.type) {
        case 'thinking_start':
          trace('events', opts.assistantMessageId, 'thinking_start');
          stx.dispatchMessageAction(opts.assistantMessageId, { type: 'THINK_START' } as any);
          break;
        case 'thinking_token':
          if ((event.content || '').length > 0 && (eventCounts['thinking_token'] % 20 === 1)) {
            trace('events', opts.assistantMessageId, `thinking_token +${(event.content || '').length}`);
          }
          if (event.content) stx.dispatchMessageAction(opts.assistantMessageId, { type: 'THINK_APPEND', chunk: event.content } as any);
          break;
        case 'thinking_end':
          trace('events', opts.assistantMessageId, 'thinking_end');
          stx.dispatchMessageAction(opts.assistantMessageId, { type: 'THINK_END' } as any);
          break;
        case 'content_token': {
          const raw = String(event.content || '');
          if (!raw) break;
          // 抑制阀：在追问/降级链路中，同样提前吞掉工具指令，避免短暂暴露
          const chunk = applySuppressionValveLocal(raw);
          if (!chunk) break;
          hadText = true;
          appender.append(chunk);
          contentChars += chunk.length;
          if (contentChars >= 500 && contentChars % 500 < chunk.length) {
            trace('events', opts.assistantMessageId, `content_token total=${contentChars}`);
          }
          // 段渲染：交给 FSM/segments 处理过滤
          stx.dispatchMessageAction(opts.assistantMessageId, { type: 'TOKEN_APPEND', chunk } as any);

          // 兜底识别：在抑制后累积一段文本，用 extractToolCallFromText 解析函数式/GPT‑OSS 变体
          detectBuf += chunk;
          if (detectBuf.length > 2048) detectBuf = detectBuf.slice(-2048);
          if (!pending) {
            try {
              const parsed = extractToolCallFromText(detectBuf);
              if (parsed && parsed.server && parsed.tool) {
                void handleToolCallInternal({ server: parsed.server, tool: parsed.tool, arguments: parsed.args });
                detectBuf = ''; // 命中后清空，避免重复
              }
            } catch { /* noop */ }
          }
          break;
        }
        case 'tool_call': {
          void handleToolCallInternal(event.parsed || {});
          break;
        }
        default:
          break;
      }
    },
    flush: () => {
      try {
        // 1) 处理抑制阀尾部：
        //    - 若仍在抑制态：尝试解析被吞内容并触发工具卡；
        //    - 若未在抑制态但缓冲区仍有守护窗口的尾部：把这部分作为普通文本补齐输出，避免“尾巴丢字”。
        const stx = useChatStore.getState();
        const flushed = suppressor.flush();
        if (flushed.hadSuppression) {
          try {
            if (flushed.captured) {
              const parsed = extractToolCallFromText(flushed.captured);
              if (parsed && parsed.server && parsed.tool) {
                void handleToolCallInternal({ server: parsed.server, tool: parsed.tool, arguments: parsed.args });
              }
            }
          } catch { /* noop */ }
        } else if (flushed.tail) {
          const tail = flushed.tail;
          if (tail && tail.length > 0) {
            hadText = hadText || tail.trim().length > 0;
            appender.append(tail);
            stx.dispatchMessageAction(opts.assistantMessageId, { type: 'TOKEN_APPEND', chunk: tail } as any);
          }
        }
      } catch { /* noop */ }

      try { appender.flush(); } catch { /* noop */ }
      trace('events', opts.assistantMessageId, 'summary', { counts: eventCounts, contentChars, pendingTool: pending });
    },
    getState: () => ({ hadText, pendingTool: pending })
  };
}


