import type { Message as LlmMessage } from '@/lib/llm/types';
import { streamChat } from '@/lib/llm';
import { ProviderRegistry } from '@/lib/llm/ProviderRegistry';
import { StreamOrchestrator } from '@/lib/chat/stream/StreamOrchestrator';
import type { OnToolCall } from '@/lib/chat/stream/types';
import { ToolCallCoordinator } from '@/lib/mcp/ToolCallCoordinator';
import { ToolExecutionPipeline, ToolInvocation } from '@/lib/mcp/pipeline';
import { createDefaultAdapters } from '@/lib/mcp/pipeline/adapters';
import { useChatStore } from '@/store/chatStore';

import type { AgentLoopCancelParams, AgentLoopRunParams } from './types';
import { AgentRunControlPlane } from './AgentRunControlPlane';
import { AgentRunEventStore } from './AgentRunEventStore';
import { buildAgentPromptEnvelope, dedupeEnvelopeSystemPrefix } from './buildAgentPromptEnvelope';
import { resolveAgentToolCapability } from './resolveAgentToolCapability';
import { applyCitations } from '@/lib/rag/CitationService';
import { listEvidence } from '@/lib/rag/EvidenceRegistry';
import { isPipelineSkipped } from '@/lib/mcp/shared/toolResultGuards';
import { ConversationEventLog } from '@/lib/mcp/pipeline/context/ConversationEventLog';

const coordinator = ToolCallCoordinator.getInstance();
const DEFAULT_PIPELINE = new ToolExecutionPipeline({ adapters: createDefaultAdapters() });

const MAX_MODEL_STEPS = 50;

const activeLoops = new Map<string, { controller: AbortController; provider: string; conversationId: string }>();
const steeringInputs = new Map<string, string[]>();
// 一个本地模型端点只允许一个请求进入 Provider；不同端点仍可并行。
const endpointTails = new Map<string, Promise<void>>();

/** Queue a user steering message for the next safe model boundary. */
export function queueAgentSteering(assistantMessageId: string, input: string): boolean {
  const id = String(assistantMessageId || '').trim();
  const text = String(input || '').trim();
  if (!id || !text || !activeLoops.has(id)) return false;
  const pending = steeringInputs.get(id) || [];
  pending.push(text);
  steeringInputs.set(id, pending);
  return true;
}

function isCancelled(assistantMessageId: string, signal: AbortSignal): boolean {
  return coordinator.isMessageCancelled(assistantMessageId) || signal.aborted;
}

async function setAgentRunState(params: { assistantMessageId: string; running: boolean; conversationId?: string }) {
  try {
    useChatStore.getState().setAgentRunState(params);
  } catch {
    // ignore
  }
}

async function ensureAssistantLoading(assistantMessageId: string) {
  try {
    await useChatStore.getState().updateMessage(assistantMessageId, { status: 'loading' } as any);
  } catch {
    // ignore (best-effort)
  }
}

export class AgentLoopRunner {
  static steer(assistantMessageId: string, input: string): boolean {
    return queueAgentSteering(assistantMessageId, input);
  }
  static cancel(params: AgentLoopCancelParams) {
    const id = String(params.assistantMessageId || '').trim();
    if (!id) return;
    const active = activeLoops.get(id);
    if (active) {
      try {
        active.controller.abort();
      } catch {
        // ignore
      }
      // Cancel only the provider selected by this run.  The old global
      // interpreter cancellation could terminate an unrelated conversation.
      try { ProviderRegistry.get(active.provider)?.cancelStream?.(); } catch { /* ignore */ }
    }
    void AgentRunEventStore.setRunStatus(id, 'cancelled').catch(() => {});
    try {
      void import('@tauri-apps/api/core').then(({ invoke }) =>
        invoke('cancel_safe_shell', { executionId: id }).catch(() => {}),
      );
    } catch {
      // ignore
    }
  }

  static async run(params: AgentLoopRunParams): Promise<void> {
    const assistantMessageId = String(params.assistantMessageId || '').trim();
    const conversationId = String(params.conversationId || '').trim();
    const provider = String(params.provider || '').trim();
    const model = String(params.model || '').trim();
    const originalUserContent = String(params.continuationPrompt || params.originalUserContent || '');
    const baseHistory: LlmMessage[] = [...(params.historyForLlm || [])] as LlmMessage[];
    const baseOptions: Record<string, any> = { ...(params.options || {}), conversationId, messageId: assistantMessageId };
    const hooks = params.runtimeHooks;
    const planOnly = Boolean(params.planOnly || (params.options as any)?.planOnly);

    if (!assistantMessageId || !conversationId || !provider || !model) throw new Error('运行参数不完整');

    // 单实例：同一 assistantMessageId 只允许一个 loop
    if (activeLoops.has(assistantMessageId) || [...activeLoops.values()].some((run) => run.conversationId === conversationId)) {
      throw new Error('当前会话已有运行中的任务');
    }
    const ctrl = new AbortController();
    activeLoops.set(assistantMessageId, { controller: ctrl, provider, conversationId });
    steeringInputs.set(assistantMessageId, []);

    const endpointKey = `${provider}\u0000${model}`;
    const previousEndpointRun = endpointTails.get(endpointKey) || Promise.resolve();
    let releaseEndpoint!: () => void;
    const endpointTurn = new Promise<void>((resolve) => { releaseEndpoint = resolve; });
    const endpointTail = previousEndpointRun.then(() => endpointTurn);
    endpointTails.set(endpointKey, endpointTail);
    await previousEndpointRun;
    if (ctrl.signal.aborted) {
      activeLoops.delete(assistantMessageId);
      steeringInputs.delete(assistantMessageId);
      releaseEndpoint();
      if (endpointTails.get(endpointKey) === endpointTail) endpointTails.delete(endpointKey);
      return;
    }

    const controlPlane = new AgentRunControlPlane(assistantMessageId, conversationId, assistantMessageId);
    let streamFailed = false;
    let runError: unknown;
    let terminalStatus: 'paused' | undefined;

    await setAgentRunState({ assistantMessageId, conversationId, running: true });

    try {
      await controlPlane.start();
      // The history builder normally already contains the current user turn.
      // Record it only when a caller starts from an older checkpoint; otherwise
      // the first model request would contain the same input twice.
      const lastMessage = baseHistory.at(-1);
      const currentUserAlreadyInHistory = lastMessage?.role === 'user' && lastMessage.content === originalUserContent;
      if (originalUserContent.trim() && !currentUserAlreadyInHistory) {
        await controlPlane.record({ type: 'user_message', content: originalUserContent });
      }
      if (planOnly) {
        await controlPlane.record({
          type: 'context_change',
          kind: 'permissions',
          content: 'plan_only_mode: only bounded reads/searches may execute; writes, shell, and unknown side effects are blocked',
        });
      }
      try {
        await hooks?.onAgentStart?.({ assistantMessageId, conversationId });
      } catch {
        // ignore
      }
      // 强制注入工具定义（agent 模式）
      try {
        const { useToolLoadRequestStore } = await import('@/store/toolLoadRequestStore');
        const loadState = useToolLoadRequestStore.getState();
        if (loadState.conversationId !== conversationId) loadState.reset(conversationId);
      } catch { /* keep the catalog best-effort */ }
      const { buildMcpSystemInjections } = await import('@/lib/mcp/promptInjector');
      const injection = await buildMcpSystemInjections(originalUserContent || '', conversationId, provider, model, { forceInject: true });
      const envelope = buildAgentPromptEnvelope(injection);
      const capability = resolveAgentToolCapability(provider, model);
      let conversationHistory = dedupeEnvelopeSystemPrefix(baseHistory, envelope.prefixMessages);

      // 复用工具清单（避免每轮都计算）
      const toolOptions: Record<string, any> = { ...baseOptions };
      // Runtime-only options must not leak into provider request bodies.
      delete toolOptions.contextWindowTokens;
      delete toolOptions.planOnly;
      if (capability.useNativeTools && injection.useNativeTools && envelope.tools.length > 0) {
        toolOptions.tools = envelope.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }));
        toolOptions.toolChoice = 'auto';
        toolOptions.__useNativeTools = true;
      } else {
        delete toolOptions.tools;
        toolOptions.toolChoice = 'none';
        toolOptions.__useNativeTools = false;
      }
      const renderMode = capability.renderMode;
      if (params.continuationRunId) {
        try {
          const previousEvents = await AgentRunEventStore.loadEvents(params.continuationRunId);
          const previousLog = new ConversationEventLog();
          previousEvents.forEach((event) => previousLog.append(event));
          let previousHistory = previousLog.renderForModel(renderMode);
          const lastBase = conversationHistory.at(-1);
          if (lastBase?.role === 'user' && previousHistory[0]?.role === 'user' && lastBase.content === previousHistory[0].content) {
            previousHistory = previousHistory.slice(1);
          }
          conversationHistory = [...conversationHistory, ...previousHistory];
        } catch {
          // 缺少或损坏的旧运行只能退化为普通新回合。
        }
      }
      const refreshNativeToolOptions = async () => {
        if (!capability.useNativeTools) return;
        const refreshed = await buildMcpSystemInjections(originalUserContent || '', conversationId, provider, model, { forceInject: true });
        if (!refreshed.useNativeTools || !Array.isArray(refreshed.nativeTools)) return;
        toolOptions.tools = refreshed.nativeTools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }));
        toolOptions.toolChoice = 'auto';
        toolOptions.__useNativeTools = true;
      };

      let round = 0;
      let knowledgeToolCalls = 0;

      const markStreamFailed = async (reason: string) => {
        streamFailed = true;
        const short = String(reason || 'unknown').slice(0, 200);
        await controlPlane.record({
          type: 'context_change',
          kind: 'other',
          content: `agent_stream_failed: ${short}`,
        }).catch(() => {});
      };

      // while(true) agent loop
      while (true) {
        if (isCancelled(assistantMessageId, ctrl.signal)) {
          controlPlane.markCancelled();
          break;
        }
        const queuedSteering = steeringInputs.get(assistantMessageId)?.splice(0) || [];
        for (const steering of queuedSteering) {
          await controlPlane.record({ type: 'user_message', content: steering });
        }
        if (round >= MAX_MODEL_STEPS) {
          terminalStatus = 'paused';
          break;
        }
        round += 1;

        // 进入每一轮 stream 前，确保 message.status=loading（避免 Stop 闪烁）
        await ensureAssistantLoading(assistantMessageId);

        let catalogChanged = false;
        // Providers may deliver events before the response is complete. Collect
        // requests here; no tool side effect is permitted inside a stream callback.
        const requests = new Map<string, Parameters<OnToolCall>[0]>();
        const onToolCall: OnToolCall = (req) => {
          const key = req.callId || req.cardId || req.lockKey;
          if (!requests.has(key)) requests.set(key, req);
        };

        const orchestrator = new StreamOrchestrator({
          messageId: assistantMessageId,
          conversationId,
          provider,
          model,
          originalUserContent,
          historyForLlm: controlPlane.buildLlmMessages(conversationHistory, renderMode),
          onUIUpdate: () => {},
          onError: (error) => {
            void markStreamFailed(error?.message || 'stream_error');
          },
          onToolCall,
          skipTitleGeneration: true,
          skipEmptyBubbleRollback: true,
        });

        const callbacks = orchestrator.createCallbacks();
        let callbackQueue = Promise.resolve();
        let acceptingEvents = true;
        let resolveStream!: () => void;
        const streamDone = new Promise<void>((resolve) => { resolveStream = resolve; });
        const abortStream = () => { acceptingEvents = false; resolveStream(); };
        ctrl.signal.addEventListener('abort', abortStream, { once: true });
        // 复用 useChatActions 的监控/计数/超时逻辑：把每一轮 stream 生命周期暴露出去
        const originalOnStart = callbacks.onStart;
        callbacks.onStart = async () => {
          try {
            await hooks?.onStreamStart?.({ assistantMessageId, conversationId, round });
          } catch {
            // ignore
          }
          try {
            await (originalOnStart?.() as any);
          } catch {
            // ignore
          }
        };
        const originalOnEvent = callbacks.onEvent;
        callbacks.onEvent = (event: any) => {
          if (!acceptingEvents) return;
          callbackQueue = callbackQueue.then(async () => {
            if (ctrl.signal.aborted) return;
            hooks?.onStreamEvent?.(event, { assistantMessageId, conversationId, round });
            await originalOnEvent?.(event);
          }).catch((error) => {
            streamFailed = true;
            resolveStream();
            console.error('[AgentLoopRunner] stream event failed:', error);
          });
        };
        const originalOnComplete = callbacks.onComplete;
        callbacks.onComplete = () => {
          if (!acceptingEvents) return;
          acceptingEvents = false;
          callbackQueue = callbackQueue.then(async () => {
            await originalOnComplete?.();
            await hooks?.onStreamComplete?.({ assistantMessageId, conversationId, round });
          }).catch((error) => {
            streamFailed = true;
            console.error('[AgentLoopRunner] stream completion failed:', error);
          }).finally(resolveStream);
        };
        const originalOnError = callbacks.onError;
        callbacks.onError = (error: Error) => {
          acceptingEvents = false;
          try {
            hooks?.onStreamError?.(error, { assistantMessageId, conversationId, round });
          } catch {
            // ignore
          }
          try {
            originalOnError?.(error);
          } catch {
            // ignore
          }
          streamFailed = true;
          resolveStream();
        };

        const messages = await controlPlane.assembleRoundMessages({
          prefixMessages: envelope.prefixMessages,
          baseHistory: conversationHistory,
          renderMode,
          provider,
          model,
          contextWindowTokens: typeof baseOptions.contextWindowTokens === 'number' ? baseOptions.contextWindowTokens : undefined,
          reserveOutputTokens: typeof baseOptions.maxTokens === 'number' ? baseOptions.maxTokens : undefined,
          tools: toolOptions.tools,
        });

        // Tauri-backed providers return after registering listeners; wait for
        // protocol completion, and drain asynchronous event handlers in order.
        try {
          if (!ctrl.signal.aborted) {
            void streamChat(provider, model, messages, callbacks, toolOptions).catch((error) => {
              callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
            });
            await streamDone;
            await callbackQueue;
          }
        } finally {
          ctrl.signal.removeEventListener('abort', abortStream);
        }

        if (streamFailed) {
          break;
        }

        if (isCancelled(assistantMessageId, ctrl.signal)) {
          controlPlane.markCancelled();
          break;
        }

        const content = orchestrator.getContext().content;
        if (content?.trim()) {
          await controlPlane.record({ type: 'assistant_message', content });
        }
        if (requests.size === 0) {
          if (steeringInputs.get(assistantMessageId)?.length) continue;
          break;
        }

        // Persist every request before executing any of them. A failed write
        // must stop dispatch, not become a successful model-visible result.
        for (const [key, req] of requests) {
          await controlPlane.record({
            type: 'tool_call_requested', callId: req.callId || key,
            cardId: req.cardId, server: req.server, tool: req.tool,
            args: req.args, providerData: req.providerData,
          });
        }
        // Unknown/MCP side effects are ordered. Read-only parallel execution can
        // be added once adapters expose reliable effect metadata.
        for (const [key, req] of requests) {
          const callId = req.callId || key;
          let out: unknown = req.preResult;
          let executed = false;
          if (terminalStatus) {
            out = { ok: false, error: { code: 'NOT_DISPATCHED', message: '运行已暂停，调用未执行' } };
          } else if (isCancelled(assistantMessageId, ctrl.signal)) {
            out = { ok: false, error: { code: 'CANCELLED', message: '调用已取消' } };
          } else if (out === undefined && req.server === 'knowledge' && knowledgeToolCalls >= 12) {
            out = { ok: false, error: { code: 'KNOWLEDGE_TOOL_BUDGET', message: '已达到本轮文档读取上限，未读取剩余内容。' } };
            terminalStatus = 'paused';
          } else if (out === undefined) {
            if (req.server === 'knowledge') knowledgeToolCalls += 1;
            const inv = new ToolInvocation({
              assistantMessageId, conversationId, server: req.server, tool: req.tool,
              args: req.args || {}, provider, model,
              historyForLlm: controlPlane.buildLlmMessages(conversationHistory, renderMode),
              originalUserContent, callId, cardId: req.cardId, lockKey: req.lockKey,
              providerData: req.providerData, planOnly,
            });
            try {
              executed = true;
              out = await DEFAULT_PIPELINE.run(inv);
              if (isPipelineSkipped(out)) {
                out = { ok: false, error: { code: 'SKIPPED', message: '调用未执行' } };
              }
            } catch (error) {
              // A thrown execution error cannot establish whether a side effect
              // happened. Never retry it automatically or continue dispatching.
              out = { ok: false, error: { code: 'EXECUTION_UNKNOWN', message: String(error) } };
              terminalStatus = 'paused';
            }
          }
          if ((out as any)?.resultStatus === 'unknown') terminalStatus = 'paused';
          const toolFailed = !!(out as any)?.error || (out as any)?.ok === false;
          await controlPlane.record({
            type: 'tool_call_output', callId, cardId: req.cardId,
            server: req.server, tool: req.tool, args: req.args,
            output: out, isError: toolFailed,
          });
          if ((!executed || (out as any)?.error?.code === 'EXECUTION_UNKNOWN') && toolFailed) {
            useChatStore.getState().dispatchMessageAction(assistantMessageId, {
              type: 'TOOL_RESULT', server: req.server, tool: req.tool, cardId: req.cardId,
              ok: false, errorMessage: (out as any)?.error?.message || String((out as any)?.error || '调用未执行'),
            });
          }
          catalogChanged ||= req.server === 'tools' && (req.tool === 'load' || req.tool === 'search') && !toolFailed;
          coordinator.markToolCallComplete(req.lockKey, toolFailed ? 'failed' : 'completed');
        }
        if (terminalStatus || isCancelled(assistantMessageId, ctrl.signal)) break;

        // tools__load changes the session catalog. Apply it before the next
        // model step instead of waiting for another user message.
        if (catalogChanged) {
          try { await refreshNativeToolOptions(); } catch { /* keep the prior catalog */ }
        }

      }
    } catch (error) {
      streamFailed = true;
      runError = error;
    } finally {
      activeLoops.delete(assistantMessageId);
      steeringInputs.delete(assistantMessageId);
      releaseEndpoint();
      if (endpointTails.get(endpointKey) === endpointTail) endpointTails.delete(endpointKey);
      const finalStatus = controlPlane.isCancelled() || isCancelled(assistantMessageId, ctrl.signal)
        ? 'cancelled'
        : terminalStatus
          ? terminalStatus
        : streamFailed
          ? 'failed'
          : 'completed';
      if (finalStatus === 'cancelled') {
        await controlPlane.recordCancelled().catch(() => {});
      }
      let persistenceError: unknown;
      try { await controlPlane.finish(finalStatus); } catch (error) { persistenceError = error; }
      // Agent answers use the same deterministic citation path as the legacy
      // RAG flow. Resolve markers while the run-scoped evidence registry is
      // still alive, then persist the citation snapshot with the message.
      try {
        const evidence = listEvidence(assistantMessageId);
        if (evidence.length) {
          const st = useChatStore.getState();
          const conv = st.conversations.find((c) => c.id === conversationId);
          const message = conv?.messages?.find((m: any) => m.id === assistantMessageId) as any;
          if (message?.content) {
            const { displayAnswer, citations } = applyCitations(String(message.content), evidence);
            if (displayAnswer !== message.content || citations.length) {
              st.updateMessageContentInMemory(assistantMessageId, displayAnswer);
              await st.updateMessage(assistantMessageId, { content: displayAnswer, citations } as any);
            }
          }
        }
      } catch (error) {
        console.warn('[AgentLoopRunner] citation finalization failed:', error);
      }
      try {
        await hooks?.onAgentEnd?.({ assistantMessageId, conversationId });
      } catch {
        // ignore
      }
      try {
        const { clearEvidenceRegistry } = await import('@/lib/rag/EvidenceRegistry');
        clearEvidenceRegistry(assistantMessageId);
      } catch {
        /* noop */
      }
      await setAgentRunState({ assistantMessageId, conversationId, running: false });
      await useChatStore.getState().updateMessage(assistantMessageId, {
        status: finalStatus === 'completed' && !persistenceError ? 'sent' : finalStatus === 'cancelled' || finalStatus === 'paused' ? 'aborted' : 'error',
      }).catch(() => {});
      runError ??= persistenceError;


      // AgentLoop 结束后统一生成标题
      // 这样可以避免在每轮流完成时都触发标题生成，防止与主模型并发抢占资源
      try {
        const st = useChatStore.getState();
        const conv = st.conversations.find(c => c.id === conversationId);
        if (conv && finalStatus === 'completed' && !runError) {
          const {
            shouldGenerateTitleAfterAssistantComplete,
            extractFirstUserMessageSeed,
            isDefaultTitle,
          } = await import('@/lib/chat/TitleGenerator');
          const { generateTitle } = await import('@/lib/chat/TitleService');
          if (shouldGenerateTitleAfterAssistantComplete(conv)) {
            const seed = extractFirstUserMessageSeed(conv);
            if (seed && seed.trim()) {
              console.debug('[AgentLoopRunner] AgentLoop 结束，开始生成标题, seed:', seed.slice(0, 50));
              const gen = await generateTitle(provider, model, seed, { maxLength: 24, language: 'zh' });
              console.debug('[AgentLoopRunner] 标题生成结果:', gen);
              const st2 = useChatStore.getState();
              const conv2 = st2.conversations.find(c => c.id === conversationId);
              if (conv2 && isDefaultTitle(conv2.title) && gen && gen.trim()) {
                console.debug('[AgentLoopRunner] 更新对话标题:', gen.trim());
                void st2.renameConversation(String(conversationId), gen.trim());
              }
            }
          }
        }
      } catch (e) {
        console.error('[AgentLoopRunner] 标题生成失败:', e);
      }
    }
    if (runError) throw runError;
  }
}
