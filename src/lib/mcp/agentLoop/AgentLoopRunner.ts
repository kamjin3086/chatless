import type { Message as LlmMessage } from '@/lib/llm/types';
import { cancelStream, streamChat } from '@/lib/llm';
import { StreamOrchestrator } from '@/lib/chat/stream/StreamOrchestrator';
import type { OnToolCall } from '@/lib/chat/stream/types';
import { ToolCallCoordinator } from '@/lib/mcp/ToolCallCoordinator';
import { ToolExecutionPipeline, ToolInvocation } from '@/lib/mcp/pipeline';
import { createDefaultAdapters } from '@/lib/mcp/pipeline/adapters';
import { useChatStore } from '@/store/chatStore';

import type { AgentLoopCancelParams, AgentLoopRunParams, RunInput } from './types';
import { AgentRunControlPlane } from './AgentRunControlPlane';
import { AgentRunEventStore } from './AgentRunEventStore';
import { buildAgentPromptEnvelope } from './buildAgentPromptEnvelope';
import { logPromptComposition } from '@/lib/mcp/prompt/compositionLog';
import { resolveAgentToolCapability } from './resolveAgentToolCapability';
import { applyCitations } from '@/lib/rag/CitationService';
import { listEvidence, restoreEvidence } from '@/lib/rag/EvidenceRegistry';
import { isPipelineSkipped } from '@/lib/mcp/shared/toolResultGuards';
import { ConversationEventLog, type ConversationEvent } from '@/lib/mcp/pipeline/context/ConversationEventLog';
import { externalizeLargeToolResult } from '@/lib/mcp/toolResultAttachments';
import { modelRequestScheduler } from '@/lib/llm/ModelRequestScheduler';

const coordinator = ToolCallCoordinator.getInstance();
const DEFAULT_PIPELINE = new ToolExecutionPipeline({ adapters: createDefaultAdapters() });

const MAX_MODEL_STEPS = 50;

/**
 * Shown when a completed model step carries neither text nor tool calls.  The
 * message is kept (a run may already have produced tool side effects) and the
 * existing retry entry regenerates the answer from the durable record.
 */
export const EMPTY_MODEL_OUTPUT_NOTICE =
  '[模型未产生输出] 本次请求没有返回正文或工具调用（可能推理预算耗尽）。可点击“重试”重新生成。';

const activeLoops = new Map<string, {
  controller: AbortController;
  provider: string;
  conversationId: string;
  shellExecutionIds: Set<string>;
  modelRequestIds: Set<string>;
  controlPlane?: AgentRunControlPlane;
}>();
type SteeringInput = RunInput & { inputId: string };
const steeringInputs = new Map<string, SteeringInput[]>();
/** Queue a user steering message for the next safe model boundary. */
export async function queueAgentSteering(assistantMessageId: string, input: RunInput | string): Promise<boolean> {
  const id = String(assistantMessageId || '').trim();
  const normalized: RunInput = typeof input === 'string' ? { text: input } : input;
  const text = String(normalized.text || '').trim();
  const active = activeLoops.get(id);
  if (!id || (!text && !normalized.images?.length && !normalized.attachmentDocumentIds?.length) || !active?.controlPlane) return false;
  // Confirming a queued supplement only after this append succeeds gives it
  // the same durable boundary as the original user turn.
  const inputId = `steer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const queued = { inputId, content: text, images: normalized.images, attachmentDocumentIds: normalized.attachmentDocumentIds };
  await active.controlPlane.record({ type: 'queued_user_input', ...queued });
  const pending = steeringInputs.get(id) || [];
  pending.push({ inputId, text, images: normalized.images, attachmentDocumentIds: normalized.attachmentDocumentIds });
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
  static steer(assistantMessageId: string, input: RunInput | string): Promise<boolean> {
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
      // Providers used by the legacy interpreter keep mutable stream state.
      // Cancel each request by its own id.  The interpreter maps this to the
      // provider instance that owns the transport rather than a global stream.
      for (const requestId of active.modelRequestIds) {
        try { cancelStream(requestId); } catch { /* ignore */ }
      }
      try {
        void import('@tauri-apps/api/core').then(({ invoke }) => Promise.all(
          [
            ...[...active.shellExecutionIds].map((executionId) => invoke('cancel_safe_shell', { executionId }).catch(() => false)),
            invoke('cancel_dense_search', { requestId: id }).catch(() => false),
          ],
        )).catch(() => {});
      } catch { /* ignore */ }
    }
    void AgentRunEventStore.setRunStatus(id, 'cancelled').catch(() => {});
  }

  static async run(params: AgentLoopRunParams): Promise<void> {
    const assistantMessageId = String(params.assistantMessageId || '').trim();
    const conversationId = String(params.conversationId || '').trim();
    const provider = String(params.provider || '').trim();
    const model = String(params.model || '').trim();
    const initialInput: RunInput = params.input || { text: params.originalUserContent };
    const originalUserContent = String(params.continuationPrompt || initialInput.text || params.originalUserContent || '');
    const baseHistory: LlmMessage[] = [...(params.historyForLlm || [])] as LlmMessage[];
    const baseOptions: Record<string, any> = { ...(params.options || {}), conversationId, messageId: assistantMessageId };
    const hooks = params.runtimeHooks;
    const planOnly = Boolean(params.planOnly || (params.options as any)?.planOnly);
    const regenerate = Boolean(params.regenerate);

    if (!assistantMessageId || !conversationId || !provider || !model) throw new Error('运行参数不完整');

    // 单实例：同一 assistantMessageId 只允许一个 loop
    if (activeLoops.has(assistantMessageId) || [...activeLoops.values()].some((run) => run.conversationId === conversationId)) {
      throw new Error('当前会话已有运行中的任务');
    }
    const ctrl = new AbortController();
    activeLoops.set(assistantMessageId, { controller: ctrl, provider, conversationId, shellExecutionIds: new Set(), modelRequestIds: new Set() });
    steeringInputs.set(assistantMessageId, []);

    const providerInstance = (await import('@/lib/llm/ProviderRegistry')).ProviderRegistry.get(provider) as any;
    const providerEndpoint = String(providerInstance?.baseUrl || provider);
    // A configured endpoint, rather than its display name or model label, is
    // the actual inference bottleneck.  Do not keep this lease while tools run.
    const endpointKey = providerEndpoint.trim().replace(/\/$/, '') || provider;

    const controlPlane = new AgentRunControlPlane(assistantMessageId, conversationId, assistantMessageId, {
      parentRunId: params.continuationRunId || params.regenerationParentRunId,
      runKind: regenerate ? 'regeneration' : params.continuationRunId ? 'continuation' : 'normal',
    });
    const active = activeLoops.get(assistantMessageId);
    if (active) active.controlPlane = controlPlane;
    let streamFailed = false;
    let runError: unknown;
    let terminalStatus: 'paused' | undefined;
    // A run that ends without any visible answer is not a success: the user
    // gets an empty bubble and no clue what happened.  Track whether this run
    // ever produced visible text so the terminal state can say so.
    let producedVisibleContent = false;
    let emptyModelOutput = false;

    await setAgentRunState({ assistantMessageId, conversationId, running: true });

    try {
      await controlPlane.start();
      // The history builder normally already contains the current user turn.
      // Record it only when a caller starts from an older checkpoint; otherwise
      // the first model request would contain the same input twice.
      const lastMessage = baseHistory.at(-1);
      const currentUserAlreadyInHistory = lastMessage?.role === 'user' && lastMessage.content === originalUserContent;
      if (originalUserContent.trim() || initialInput.images?.length || initialInput.attachmentDocumentIds?.length) {
        await controlPlane.record({ type: 'user_message', content: originalUserContent,
          images: initialInput.images, attachmentDocumentIds: initialInput.attachmentDocumentIds });
      }
      try {
        await hooks?.onAgentStart?.({ assistantMessageId, conversationId });
      } catch {
        // ignore
      }
      const { buildMcpSystemInjections } = await import('@/lib/mcp/promptInjector');
      // Interface language and plan-only are prompt inputs, not run events: the
      // contract stays stable for the conversation while the mode is a turn block.
      const promptOptions = {
        forceInject: true,
        locale: (await import('@/store/localeStore')).useLocaleStore.getState().locale,
        planOnly,
      };
      const injection = await buildMcpSystemInjections(originalUserContent || '', conversationId, provider, model, promptOptions);
      const envelope = buildAgentPromptEnvelope(injection);
      logPromptComposition(conversationId, envelope);
      const capability = resolveAgentToolCapability(provider, model);
      // The current turn is always a durable run event. Remove its duplicate
      // from the caller-built history before projecting the event log.
      const historyBeforeCurrentInput = currentUserAlreadyInHistory ? baseHistory.slice(0, -1) : baseHistory;
      // The composer is the only source of system text, so nothing has to be
      // de-duplicated from the caller-built history any more.
      let conversationHistory = historyBeforeCurrentInput;

      // 复用工具清单（避免每轮都计算）
      const toolOptions: Record<string, any> = { ...baseOptions };
      // Runtime-only options must not leak into provider request bodies.
      delete toolOptions.contextWindowTokens;
      delete toolOptions.planOnly;
      if (!regenerate && capability.useNativeTools && injection.useNativeTools && envelope.tools.length > 0) {
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
      if (regenerate && params.regenerationParentRunId) {
        // A regeneration keeps the facts the previous run gathered — its tool
        // results and citation mapping — but not its answer, so the model
        // revises instead of continuing. Tools stay blocked for this run.
        try {
          const previousMessage = useChatStore.getState().conversations
            .find((conversation) => conversation.id === conversationId)?.messages
            .find((message) => message.id === params.regenerationParentRunId);
          if (previousMessage?.citations?.length) {
            restoreEvidence(assistantMessageId, previousMessage.citations.map((citation) => ({
              id: citation.evidenceId || citation.id,
              documentId: citation.documentId,
              documentName: citation.documentName,
              documentPath: citation.documentPath,
              documentHash: citation.documentHash,
              sourceBlockIds: [],
              locator: citation.locator,
              quote: citation.quote,
              score: 0,
            })));
          }
          const recorded = await AgentRunEventStore.loadEvents(params.regenerationParentRunId);
          const digest = recorded
            .filter((event): event is Extract<ConversationEvent, { type: 'tool_call_output' }> =>
              event.type === 'tool_call_output')
            .map((event) => {
              const output = typeof event.output === 'string' ? event.output : JSON.stringify(event.output);
              const clipped = output.length > 400 ? `${output.slice(0, 400)}…` : output;
              return `- ${event.server}.${event.tool} → ${clipped}`;
            });
          if (digest.length) {
            // A run note, not a second system prompt.  Providers reject a
            // system message that appears after a non-system turn — the
            // homelab gateway answers HTTP 400 "message N has role 'system'
            // after a non-system turn" and the whole retry fails.  Runtime
            // notes therefore render as a tagged user turn, exactly like
            // ConversationEventLog does for context_change events.
            const note: LlmMessage = {
              role: 'user',
              content: [
                '[Run note] Tool results already completed by the previous run:',
                ...digest,
                'These are established facts. Do not repeat those operations and do not reuse the previous answer; write the answer again from scratch.',
              ].join('\n'),
            };
            const lastIndex = conversationHistory.length - 1;
            if (conversationHistory[lastIndex]?.role === 'user') conversationHistory.splice(lastIndex, 0, note);
            else conversationHistory.push(note);
          }
        } catch {
          // Regeneration still produces an answer without the prior facts.
        }
      }
      if (params.continuationRunId) {
        try {
          const previousMessage = useChatStore.getState().conversations
            .find((conversation) => conversation.id === conversationId)?.messages
            .find((message) => message.id === params.continuationRunId);
          if (previousMessage?.citations?.length) {
            restoreEvidence(assistantMessageId, previousMessage.citations.map((citation) => ({
              id: citation.evidenceId || citation.id,
              documentId: citation.documentId,
              documentName: citation.documentName,
              documentPath: citation.documentPath,
              documentHash: citation.documentHash,
              sourceBlockIds: [],
              locator: citation.locator,
              quote: citation.quote,
              score: 0,
            })));
          }
          const previousEvents = await AgentRunEventStore.loadEvents(params.continuationRunId);
          const previousLog = new ConversationEventLog();
          previousEvents.forEach((event) => previousLog.append(event));
          let previousHistory = previousLog.renderForModel(renderMode);
          const lastBase = conversationHistory.at(-1);
          if (lastBase?.role === 'user' && previousHistory[0]?.role === 'user' && lastBase.content === previousHistory[0].content) {
            previousHistory = previousHistory.slice(1);
          }
          conversationHistory = [...conversationHistory, ...previousHistory];
          // Queued supplements were persisted before acknowledgement.  If a
          // run stopped before its next safe boundary, deliver them in this
          // new run instead of silently losing the user's correction.
          const delivered = new Set(previousEvents
            .filter((event): event is Extract<typeof event, { type: 'user_message' }> => event.type === 'user_message')
            .map((event) => event.inputId)
            .filter((inputId): inputId is string => Boolean(inputId)));
          for (const event of previousEvents) {
            if (event.type === 'queued_user_input' && !delivered.has(event.inputId)) {
              await controlPlane.record({ type: 'user_message', inputId: event.inputId, content: event.content,
                images: event.images, attachmentDocumentIds: event.attachmentDocumentIds });
            }
          }
        } catch (error) {
          throw new Error(`无法继续该任务：运行记录不可用或已损坏。${error instanceof Error ? ` ${error.message}` : ''}`);
        }
      }
      const refreshNativeToolOptions = async () => {
        if (regenerate || !capability.useNativeTools) return;
        const refreshed = await buildMcpSystemInjections(originalUserContent || '', conversationId, provider, model, promptOptions);
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
        // Providers explain failures in the body of their error response; the
        // recorded reason is the only surviving copy, so it must not be cut
        // down to a fragment that hides the cause.
        const short = String(reason || 'unknown').slice(0, 2000);
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
        // A queued supplement is only projected as a user message at a safe
        // model boundary, after all tool results from the current response.
        // This preserves native tool-call ordering.
        const queued = steeringInputs.get(assistantMessageId)?.splice(0) || [];
        for (const input of queued) {
          await controlPlane.record({ type: 'user_message', inputId: input.inputId, content: input.text,
            images: input.images, attachmentDocumentIds: input.attachmentDocumentIds });
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
            const requestId = `agent-${assistantMessageId}-${round}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            activeLoops.get(assistantMessageId)?.modelRequestIds.add(requestId);
            try {
              await modelRequestScheduler.schedule(endpointKey, { signal: ctrl.signal }, async () => {
                if (ctrl.signal.aborted) return;
                void streamChat(provider, model, messages, callbacks, { ...toolOptions, __requestId: requestId, __schedulerLease: true }).catch((error) => {
                  callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
                });
                await streamDone;
                await callbackQueue;
              });
            } finally {
              activeLoops.get(assistantMessageId)?.modelRequestIds.delete(requestId);
            }
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
        if (content?.trim()) producedVisibleContent = true;
        const modelEvents: import('@/lib/mcp/pipeline/context/ConversationEventLog').ConversationEvent[] = [];
        if (content?.trim()) modelEvents.push({ type: 'assistant_message', content });
        for (const [key, req] of requests) {
          modelEvents.push({ type: 'tool_call_requested', callId: req.callId || key,
            cardId: req.cardId, server: req.server, tool: req.tool, args: req.args, providerData: req.providerData });
        }
        await controlPlane.commitModelStep(modelEvents);
        if (requests.size === 0) {
          if (steeringInputs.get(assistantMessageId)?.length) continue;
          if (!producedVisibleContent) {
            emptyModelOutput = true;
            await controlPlane.record({
              type: 'context_change',
              kind: 'other',
              content: `agent_run_empty_output: step=${round}`,
            }).catch(() => {});
          }
          break;
        }

        // The complete assistant response and all requests were committed as
        // one durable boundary above. No side effect starts before it succeeds.
        // Unknown/MCP side effects are ordered. Read-only parallel execution can
        // be added once adapters expose reliable effect metadata.
        let steeringPreempted = false;
        for (const [key, req] of requests) {
          const callId = req.callId || key;
          let out: unknown = req.preResult;
          let executed = false;
          if (regenerate) {
            out = { ok: false, error: { code: 'REGENERATE_TOOL_BLOCKED', message: 'Regeneration may only reorganise existing records; tools must not run.' } };
          } else if (steeringInputs.get(assistantMessageId)?.length) {
            steeringPreempted = true;
            out = { ok: false, error: { code: 'NOT_DISPATCHED', message: 'The user added input; the call did not run while the model decides again.' } };
          } else if (terminalStatus) {
            out = { ok: false, error: { code: 'NOT_DISPATCHED', message: 'The run is paused; the call did not run' } };
          } else if (isCancelled(assistantMessageId, ctrl.signal)) {
            out = { ok: false, error: { code: 'CANCELLED', message: 'The call was cancelled' } };
          } else if (out === undefined && req.server === 'knowledge' && knowledgeToolCalls >= 12) {
            out = { ok: false, error: { code: 'KNOWLEDGE_TOOL_BUDGET', message: 'The document read budget for this run is used up; the remaining content was not read.' } };
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
              await controlPlane.record({
                type: 'tool_call_started', callId, cardId: req.cardId,
                server: req.server, tool: req.tool, args: req.args,
              });
              if (req.server === 'shell' || req.server === 'shell_executor') {
                activeLoops.get(assistantMessageId)?.shellExecutionIds.add(`shell:${assistantMessageId}:${req.cardId}`);
              }
              executed = true;
              out = await DEFAULT_PIPELINE.run(inv);
              if (isPipelineSkipped(out)) {
                out = { ok: false, error: { code: 'SKIPPED', message: 'The call did not run' } };
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
          const modelOutput = await externalizeLargeToolResult({ conversationId, runId: assistantMessageId, callId, output: out });
          await controlPlane.record({
            type: 'tool_call_output', callId, cardId: req.cardId,
            server: req.server, tool: req.tool, args: req.args,
            output: modelOutput, isError: toolFailed,
          });
          if ((!executed || (out as any)?.error?.code === 'EXECUTION_UNKNOWN') && toolFailed) {
            useChatStore.getState().dispatchMessageAction(assistantMessageId, {
              type: 'TOOL_RESULT', server: req.server, tool: req.tool, cardId: req.cardId,
              ok: false, errorMessage: (out as any)?.error?.message || String((out as any)?.error || '调用未执行'),
            });
          }
          catalogChanged ||= req.server === 'tools' && req.tool === 'search' && !toolFailed;
          coordinator.markToolCallComplete(req.lockKey, toolFailed ? 'failed' : 'completed');
        }
        if (steeringPreempted) continue;
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
      const ownedShells = activeLoops.get(assistantMessageId)?.shellExecutionIds;
      activeLoops.delete(assistantMessageId);
      steeringInputs.delete(assistantMessageId);
      const finalStatus = controlPlane.isCancelled() || isCancelled(assistantMessageId, ctrl.signal)
        ? 'cancelled'
        : terminalStatus
          ? terminalStatus
        : streamFailed
          ? 'failed'
        : emptyModelOutput
          ? 'failed'
          : 'completed';
      // Background processes started by this run survive a normal reply so the
      // site keeps serving; a stopped run takes its own children with it.
      if (finalStatus === 'cancelled' && ownedShells?.size) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await Promise.all([...ownedShells].map((executionId) =>
            invoke('cancel_safe_shell', { executionId }).catch(() => false)));
        } catch {
          // The Rust side still cleans up on app exit.
        }
      }
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
      const messageStatus = finalStatus === 'completed' && !persistenceError
        ? 'sent'
        : finalStatus === 'cancelled' || finalStatus === 'paused'
          ? 'aborted'
          : 'error';
      // Keep the message and say why it is empty.  The user needs a visible
      // terminal state and the existing retry entry instead of a blank bubble;
      // the run may already have produced tool side effects, so the bubble is
      // never rolled back here.
      await useChatStore.getState().updateMessage(assistantMessageId, {
        status: messageStatus,
        ...(emptyModelOutput && messageStatus === 'error' ? { content: EMPTY_MODEL_OUTPUT_NOTICE } : {}),
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
