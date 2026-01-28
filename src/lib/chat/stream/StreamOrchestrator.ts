/**
 * 流式处理编排器
 * 
 * 职责：
 * - 协调所有事件处理器
 * - 管理流式处理上下文
 * - 提供统一的流处理入口
 * - 处理错误和完成逻辑
 */

import type { StreamEvent } from '@/lib/llm/types/stream-events';
import type { StreamCallbacks } from '@/lib/llm/types';
import type { EventHandler, StreamContext, StreamOrchestratorConfig } from './types';
import { ThinkingEventHandler } from './handlers/ThinkingEventHandler';
import { ContentEventHandler } from './handlers/ContentEventHandler';
import { ToolCallEventHandler } from './handlers/ToolCallEventHandler';
import { StreamResponseLogger } from './response-logger';
import { useChatStore } from '@/store/chatStore';
import { cleanToolCallInstructionsForDisplay } from '@/lib/chat/tool-call-cleanup';
import { ToolCallCoordinator } from '@/lib/mcp/ToolCallCoordinator';


/**
 * 流式处理编排器
 */
export class StreamOrchestrator {
  private context: StreamContext;
  private handlers: EventHandler[];
  private config: StreamOrchestratorConfig;
  private responseLogger: StreamResponseLogger;
  private coordinator = ToolCallCoordinator.getInstance();
  private didHandleComplete = false;

  constructor(config: StreamOrchestratorConfig) {
    this.config = config;
    
    // 初始化上下文
    this.context = {
      messageId: config.messageId,
      conversationId: config.conversationId,
      content: '',
      toolStarted: false,
      thinkingStartTime: 0,
      fsmState: 'RENDERING_BODY',
      metadata: {
        provider: config.provider,
        model: config.model,
        originalUserContent: config.originalUserContent,
        historyForLlm: config.historyForLlm,
      },
    };

    // 初始化响应日志记录器
    this.responseLogger = new StreamResponseLogger(config.provider, config.model);

    // 注册事件处理器
    this.handlers = [
      new ThinkingEventHandler(),
      new ContentEventHandler(),
      new ToolCallEventHandler(),
    ];
  }

  /**
   * 创建流式回调
   */
  createCallbacks(): StreamCallbacks {
    return {
      onStart: () => {
        // 流开始 - 可以在这里做初始化
      },

      onEvent: async (event: StreamEvent) => {
        try {
          await this.handleEvent(event);
        } catch (error) {
          console.error('[StreamOrchestrator] 处理事件失败:', error);
          this.config.onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      },

      onComplete: async () => {
        try {
          // 在完成前尝试冲刷抑制阀缓冲区中的尾部可见文本
          // ✅ 稳定版：优先冲刷共享状态机（toolInstructionSuppressor）的 guardWindow 尾巴，避免短文本尾部“卡住不显示”
          try {
            const store = useChatStore.getState();
            const anyCtx = this.context as any;
            const sup = anyCtx?._toolSuppressor as { flush?: () => { tail: string; captured?: string; hadSuppression: boolean } } | undefined;
            if (store && sup?.flush) {
              const flushed = sup.flush();
              if (flushed?.tail) {
                store.dispatchMessageAction(this.context.messageId, { type: 'TOKEN_APPEND', chunk: flushed.tail } as any);
              }
            } else {
              // 兼容旧实现：冲刷 context.suppression.buffer
              const s = (this.context as any).suppression as { buffer?: string; active?: boolean } | undefined;
              if (store && s && !s.active && s.buffer && s.buffer.length > 0) {
                const tail = s.buffer;
                s.buffer = '';
                store.dispatchMessageAction(this.context.messageId, { type: 'TOKEN_APPEND', chunk: tail } as any);
              }
            }

            // 冲刷 inline thinking 解析器尾部（例如 <think> 未闭合时）
            const inline = anyCtx?._inlineThinking as { flush?: () => Array<{ type: string; text?: string }> } | undefined;
            if (store && inline?.flush) {
              const evs = inline.flush();
              for (const ev of evs || []) {
                if (ev.type === 'text' && ev.text) store.dispatchMessageAction(this.context.messageId, { type: 'TOKEN_APPEND', chunk: String(ev.text) } as any);
                else if (ev.type === 'think_start') store.dispatchMessageAction(this.context.messageId, { type: 'THINK_START' } as any);
                else if (ev.type === 'think_token' && ev.text) store.dispatchMessageAction(this.context.messageId, { type: 'THINK_APPEND', chunk: String(ev.text) } as any);
                else if (ev.type === 'think_end') store.dispatchMessageAction(this.context.messageId, { type: 'THINK_END' } as any);
              }
            }
          } catch { /* 忽略冲刷失败，不影响收尾 */ }

          await this.handleComplete();
        } catch (error) {
          console.error('[StreamOrchestrator] 完成处理失败:', error);
          this.config.onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      },

      onError: (error: Error) => {
        console.error('[StreamOrchestrator] 流式错误:', error);
        try {
          const store = useChatStore.getState();
          // 错误分支同样需要在结束前冲刷抑制阀缓冲，避免尾部文本丢失
          try {
            const anyCtx = this.context as any;
            const sup = anyCtx?._toolSuppressor as { flush?: () => { tail: string; captured?: string; hadSuppression: boolean } } | undefined;
            if (store && sup?.flush) {
              const flushed = sup.flush();
              if (flushed?.tail) {
                store.dispatchMessageAction(this.context.messageId, { type: 'TOKEN_APPEND', chunk: flushed.tail } as any);
              }
            } else {
              const s = (this.context as any).suppression as { buffer?: string; active?: boolean } | undefined;
              if (store && s && !s.active && s.buffer && s.buffer.length > 0) {
                const tail = s.buffer;
                s.buffer = '';
                store.dispatchMessageAction(this.context.messageId, { type: 'TOKEN_APPEND', chunk: tail } as any);
              }
            }

            // 冲刷 inline thinking 解析器尾部
            const inline = anyCtx?._inlineThinking as { flush?: () => Array<{ type: string; text?: string }> } | undefined;
            if (store && inline?.flush) {
              const evs = inline.flush();
              for (const ev of evs || []) {
                if (ev.type === 'text' && ev.text) store.dispatchMessageAction(this.context.messageId, { type: 'TOKEN_APPEND', chunk: String(ev.text) } as any);
                else if (ev.type === 'think_start') store.dispatchMessageAction(this.context.messageId, { type: 'THINK_START' } as any);
                else if (ev.type === 'think_token' && ev.text) store.dispatchMessageAction(this.context.messageId, { type: 'THINK_APPEND', chunk: String(ev.text) } as any);
                else if (ev.type === 'think_end') store.dispatchMessageAction(this.context.messageId, { type: 'THINK_END' } as any);
              }
            }
          } catch { /* noop */ }
          // 结束思考态（如仍在进行）
          try {
            const conv = store.conversations.find(c => c.id === this.context.conversationId);
            const msg: any = conv?.messages.find(m => m.id === this.context.messageId);
            const segs = Array.isArray(msg?.segments) ? msg.segments : [];
            const stillThinking = segs.length && segs[segs.length - 1]?.kind === 'think';
            if (stillThinking) {
              store.dispatchMessageAction(this.context.messageId, { type: 'THINK_END' } as any);
            }
          } catch { /* noop */ }

          // 派发流结束，确保 UI 与段模型收尾并触发必要的持久化
          try {
            store.dispatchMessageAction(this.context.messageId, { type: 'STREAM_END' } as any);
          } catch { /* noop */ }

          // 计算思考时长（若有）
          const thinking_duration = this.context.thinkingStartTime > 0
            ? Math.floor((Date.now() - this.context.thinkingStartTime) / 1000)
            : undefined;

          // 检测是否“没有任何有效输出”的空气泡
          try {
            const conv = store.conversations.find(c => c.id === this.context.conversationId);
            const msg: any = conv?.messages.find(m => m.id === this.context.messageId);
            const hasText = !!(msg?.content && String(msg.content).trim().length > 0);
            const hasSegs = Array.isArray(msg?.segments) && msg.segments.length > 0;

            if (!hasText && !hasSegs) {
              // 1) 删除这个无意义的 AI 气泡
              try { void store.deleteMessage(this.context.messageId); } catch { /* noop */ }
              // 1.1) 同时删除刚刚发送的 user 消息（避免用户回显后再次发送产生重复）
              try {
                const conv2 = store.conversations.find(c => c.id === this.context.conversationId);
                const msgs = conv2?.messages || [];
                const aIndex = msgs.findIndex((m: any) => m.id === this.context.messageId);
                if (aIndex > 0) {
                  const prev = msgs[aIndex - 1] as any;
                  const sameText = String(prev?.content || '').trim() === String(this.config.originalUserContent || '').trim();
                  if (prev?.role === 'user' && sameText) {
                    void store.deleteMessage(prev.id);
                  }
                }
              } catch { /* noop */ }
              // 2) 回显用户输入到输入框与草稿
              const text = String(this.config.originalUserContent || '').trim();
              if (text) {
                try { if (this.context.conversationId) store.setInputDraft(this.context.conversationId, text); } catch { /* noop */ }
                try { window.dispatchEvent(new CustomEvent('chat-input-fill', { detail: text })); } catch { /* noop */ }
              }
            } else {
              // 有部分输出：把状态标为 error，并尽量保留已生成内容
              let contentToPersist = this.context.content;
              if (!contentToPersist || String(contentToPersist).trim().length === 0) {
                contentToPersist = (error as any)?.userMessage || (error?.message || '请求失败');
              }
              // 关键修复：错误分支也要清理工具指令，避免在卡片失败时把原始指令“回灌”到正文
              // display 版本会额外清理流式输出的半截标签尾巴（如 "<use_mcp_tool"）
              try { contentToPersist = cleanToolCallInstructionsForDisplay(String(contentToPersist)); } catch { /* noop */ }
              void store.updateMessage(this.context.messageId, {
                status: 'error',
                content: contentToPersist,
                thinking_start_time: this.context.thinkingStartTime || undefined,
                thinking_duration,
              });
            }
          } catch {
            // 回退：无法读取消息时，至少把错误消息写入
            let contentToPersist = this.context.content;
            if (!contentToPersist || String(contentToPersist).trim().length === 0) {
              contentToPersist = (error as any)?.userMessage || (error?.message || '请求失败');
            }
            try { contentToPersist = cleanToolCallInstructionsForDisplay(String(contentToPersist)); } catch { /* noop */ }
            void store.updateMessage(this.context.messageId, {
              status: 'error',
              content: contentToPersist,
              thinking_start_time: this.context.thinkingStartTime || undefined,
              thinking_duration,
            });
          }
        } catch { /* 忽略状态修复中的非致命错误 */ }

        // 通知上层（用于 toast 与清理定时器）
        this.config.onError?.(error);
      },
    };
  }

  /**
   * 处理单个事件
   */
  private async handleEvent(event: StreamEvent): Promise<void> {

    
    // 记录到响应日志（非侵入式）
    this.logEventToResponse(event);
    
    // 找到合适的处理器
    let handlerFound = false;
    for (const handler of this.handlers) {
      if (handler.canHandle(event)) {

        await handler.handle(event, this.context);
        handlerFound = true;
        break; // 每个事件只由一个处理器处理
      }
    }

  }

  /**
   * 将事件内容记录到响应日志（非侵入式）
   */
  private logEventToResponse(event: StreamEvent): void {
    try {
      if (event.type === 'thinking_token' && event.content) {
        this.responseLogger.appendThinking(event.content);
      } else if (event.type === 'thinking_end') {
        this.responseLogger.endThinking();
      } else if (event.type === 'content_token' && event.content) {
        this.responseLogger.appendContent(event.content);
      }
    } catch (error) {
      // 静默失败，不影响主流程
      console.warn('[StreamOrchestrator] Logger error:', error);
    }
  }

  /**
   * 处理流完成
   */
  private async handleComplete(): Promise<void> {
    if (this.didHandleComplete) {
      debugLog('StreamOrchestrator.ts:handleComplete:dup', 'Handle complete suppressed (already ran)', {
        messageId: this.context.messageId,
        conversationId: this.context.conversationId,
        toolStarted: this.context.toolStarted,
        contentLength: (this.context.content || '').length,
      }, 'H1');
      return;
    }
    this.didHandleComplete = true;

    // 注意：useChatStore.getState() 返回的是“快照对象”；
    // handleComplete 内部会 dispatchMessageAction（会更新 store），因此不能长期复用同一个快照读取 segments。
    const store = useChatStore.getState();
    
    // 导入清理工具
    // 已在模块顶层导入 cleanToolCallInstructionsForDisplay（避免运行期动态导入带来的时序差异）

    // 获取当前消息
    const conv = store.conversations.find(c => c.id === this.context.conversationId);
    const msg = conv?.messages.find(m => m.id === this.context.messageId) as any;
    
    // 确定要持久化的内容
    const hadCardMarker = !!(msg?.content && msg.content.includes('"__tool_call_card__"'));
    let contentToPersist = hadCardMarker ? (msg?.content || this.context.content) : this.context.content;
    
    // 保存原始内容用于日志/清理参考
    const originalContent = contentToPersist;


    // Native-only + Event-only：不再允许“收尾阶段从文本中兜底解析并执行工具”。
    // 工具执行只能由结构化 tool_call 事件触发（ToolCallEventHandler）。

    // 最终清理：移除所有工具调用指令（display 版本会额外清理半截尾巴）
    contentToPersist = cleanToolCallInstructionsForDisplay(contentToPersist);

    // 计算思考时长
    const thinking_duration = this.context.thinkingStartTime > 0
      ? Math.floor((Date.now() - this.context.thinkingStartTime) / 1000)
      : undefined;

    // 派发流结束动作
    store.dispatchMessageAction(this.context.messageId, { type: 'STREAM_END' });

    // 关键：重新获取最新快照，避免读到 dispatch 前的旧 state（会导致 segCount=0 并把空 segments 持久化回去）
    const fresh = useChatStore.getState();
    const conv2 = fresh.conversations.find(c => c.id === this.context.conversationId);
    const msg2: any = conv2?.messages.find(m => m.id === this.context.messageId);
    const segsFresh = Array.isArray(msg2?.segments) ? msg2.segments : [];
    const toolCardsFresh = segsFresh.filter((s: any) => s?.kind === 'toolCard');


    // 持久化消息 - 包含 segments
    // 关键修复：使用 fresh state 的 segments 作为基准（而不是 handleComplete 入口处的旧快照 msg）
    const segmentsToPersist = segsFresh ? [...segsFresh] : [];
    if (contentToPersist && segmentsToPersist.length > 0) {
      // 找到最后一个 text segment 并更新其内容
      const lastTextIdx = segmentsToPersist.map((s: any) => s.kind).lastIndexOf('text');
      if (lastTextIdx >= 0) {
        segmentsToPersist[lastTextIdx] = { kind: 'text', text: contentToPersist };
      } else {
        // 如果没有 text segment，创建一个
        segmentsToPersist.push({ kind: 'text', text: contentToPersist });
      }
    }

    // 不要在这里强行覆盖为 sent：流可能结束但工具仍在运行，消息状态由 chatStore 的 FSM 决定更准确
    const statusToPersist = (msg2 && typeof msg2.status === 'string') ? msg2.status : 'sent';
    await store.updateMessage(this.context.messageId, {
      content: contentToPersist,
      status: statusToPersist,
      thinking_start_time: this.context.thinkingStartTime || undefined,
      thinking_duration,
      segments: segmentsToPersist, // 关键：保存同步后的 segments
    });


    // 通知UI更新完成
    this.config.onUIUpdate?.(contentToPersist);

    // 标题生成（通用路径）：在任意一次助手首次完成后尝试生成
    // MCP 递归链已在 Orchestrator 外部（ToolCallOrchestrator）增加一次调用，此处作为通用兜底；
    // 由于包含 isDefaultTitle 判定，不会重复生成。
    try {
      const st = useChatStore.getState();
      const conv = st.conversations.find(c => c.id === this.context.conversationId);
      if (conv) {
        const {
          shouldGenerateTitleAfterAssistantComplete,
          extractFirstUserMessageSeed,
          isDefaultTitle,
        } = await import('@/lib/chat/TitleGenerator');
        const { generateTitle } = await import('@/lib/chat/TitleService');
        if (shouldGenerateTitleAfterAssistantComplete(conv)) {
          // 若本条消息仍处于工具链路中（存在 running/pending_auth 工具卡片），则延后标题生成：
          // - 避免与主模型并发抢占资源（性能抖动）
          // - 避免在工具未闭环时过早触发额外请求（用户观感“抢跑”）
          try {
            const msgNow: any = conv.messages?.find((m: any) => m.id === this.context.messageId);
            const segsNow = Array.isArray(msgNow?.segments) ? msgNow.segments : [];
            const toolCardsNow = segsNow.filter((s: any) => s?.kind === 'toolCard');
            const hasBlockingTool = toolCardsNow.some((t: any) => t?.status === 'running' || t?.status === 'pending_auth');
            if (hasBlockingTool) {

              return;
            }
          } catch { /* noop */ }
          const seed = extractFirstUserMessageSeed(conv);
          if (seed && seed.trim()) {
            const gen = await generateTitle(this.config.provider, this.config.model, seed, { maxLength: 24, language: 'zh' });
            const st2 = useChatStore.getState();
            const conv2 = st2.conversations.find(c => c.id === this.context.conversationId);
            if (conv2 && isDefaultTitle(conv2.title) && gen && gen.trim()) {
              void st2.renameConversation(String(this.context.conversationId), gen.trim());
            }
          }
        }
      }
    } catch { /* ignore title generation errors */ }

    // 🎯 输出完整的响应日志（在所有处理完成后）
    try {
      this.responseLogger.logComplete(this.context.messageId);
    } catch (error) {
      console.warn('[StreamOrchestrator] Failed to log response:', error);
    }
  }

  /**
   * 获取当前上下文（用于测试或调试）
   * 返回深拷贝，防止外部修改
   */
  getContext(): Readonly<StreamContext> {
    return {
      ...this.context,
      metadata: {
        ...this.context.metadata,
        historyForLlm: [...this.context.metadata.historyForLlm],
      },
    };
  }
}
