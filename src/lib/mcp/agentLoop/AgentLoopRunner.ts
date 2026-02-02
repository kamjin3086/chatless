import type { Message as LlmMessage } from '@/lib/llm/types';
import type { ToolCallRequest } from '@/lib/llm/types/tool-schema';
import { cancelStream, streamChat } from '@/lib/llm';
import { StreamOrchestrator } from '@/lib/chat/stream/StreamOrchestrator';
import type { OnToolCall } from '@/lib/chat/stream/types';
import { ToolCallCoordinator } from '@/lib/mcp/ToolCallCoordinator';
import { ToolExecutionPipeline, ToolInvocation } from '@/lib/mcp/pipeline';
import { createDefaultAdapters } from '@/lib/mcp/pipeline/adapters';
import { useChatStore } from '@/store/chatStore';

import type { AgentLoopCancelParams, AgentLoopRunParams } from './types';

type BufferedToolResult = {
  cardIdOrKey: string;
  callId: string;
  server: string;
  tool: string;
  args?: Record<string, unknown>;
  result: unknown;
};

const coordinator = ToolCallCoordinator.getInstance();
const DEFAULT_PIPELINE = new ToolExecutionPipeline({ adapters: createDefaultAdapters() });

const MAX_RESUME_ROUNDS = 8;
const MAX_SAME_ATTEMPTS = 3;
const MAX_CONSECUTIVE_EMPTY = 3;

const activeLoops = new Map<string, AbortController>();

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return '[function]';
  if (typeof value !== 'object') return '[unknown]';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${k}:${stableStringify(obj[k])}`);
  return `{${parts.join(',')}}`;
}

function classifyToolResult(result: unknown): 'success' | 'empty' | 'tool_error' {
  const isEmpty =
    !result ||
    (typeof result === 'string' && result.trim().length === 0) ||
    (Array.isArray(result) && result.length === 0);
  if (isEmpty) return 'empty';

  if (result && typeof result === 'object') {
    const r: any = result as any;
    // 结构化 error：认为是工具错误
    if (r.error) return 'tool_error';

    // ok=false：并不一定是“致命错误”（例如文件批量删除部分失败）
    // 若结果包含 deleted/failed/matched 等可行动细节，视为 success，避免 agent loop 误判为重复失败而熔断。
    if (typeof r.ok === 'boolean' && r.ok === false) {
      const hasActionableDetail =
        typeof r.failedCount === 'number' ||
        typeof r.deletedCount === 'number' ||
        typeof r.matchedCount === 'number' ||
        Array.isArray(r.failed) ||
        Array.isArray(r.deleted) ||
        Array.isArray(r.matches);
      if (!hasActionableDetail) return 'tool_error';
    }
    if (typeof r.success === 'boolean' && r.success === false) return 'tool_error';
  }
  return 'success';
}

function summarizeToolOutput(output: unknown): unknown {
  try {
    if (typeof output === 'string') {
      const s = output;
      if (s.length > 4000) return `${s.slice(0, 4000)}\n... (truncated, ${s.length} chars)`;
      return s;
    }
    if (Array.isArray(output)) {
      const arr = output as any[];
      if (arr.length <= 60) return output;
      return { summary: `Array(${arr.length}) truncated`, head: arr.slice(0, 30), tail: arr.slice(-10) };
    }
    if (output && typeof output === 'object') {
      const s = safeJson(output);
      if (s.length > 8000) return { summary: `Object truncated (${s.length} chars)`, preview: s.slice(0, 8000) };
      return output;
    }
  } catch {
    // ignore
  }
  return output;
}

function buildToolRoleAppendix(batch: BufferedToolResult[]): { assistantMsg: LlmMessage; toolMsgs: LlmMessage[] } {
  const tool_calls: ToolCallRequest[] = batch.map((r) => ({
    id: r.callId,
    type: 'function',
    function: {
      name: `${r.server}__${r.tool}`,
      arguments: safeJson(r.args || {}),
    },
  }));
  const assistantMsg: LlmMessage = { role: 'assistant', content: '', tool_calls };
  const toolMsgs: LlmMessage[] = batch.map((r) => ({
    role: 'tool',
    tool_call_id: r.callId,
    content: typeof r.result === 'string' ? r.result : safeJson(summarizeToolOutput(r.result)),
  })) as any;
  return { assistantMsg, toolMsgs };
}

function makeAttemptKey(params: { conversationId: string; server: string; tool: string; args?: Record<string, unknown> }): string {
  return `${params.conversationId}:${params.server}.${params.tool}:${stableStringify(params.args || {})}`;
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
  static cancel(params: AgentLoopCancelParams) {
    const id = String(params.assistantMessageId || '').trim();
    if (!id) return;
    const ctrl = activeLoops.get(id);
    if (ctrl) {
      try {
        ctrl.abort();
      } catch {
        // ignore
      }
    }
    // best-effort：同时停止当前全局 stream（Tauri 桌面端是单流解释器）
    try {
      cancelStream();
    } catch {
      // ignore
    }
  }

  static async run(params: AgentLoopRunParams): Promise<void> {
    const assistantMessageId = String(params.assistantMessageId || '').trim();
    const conversationId = String(params.conversationId || '').trim();
    const provider = String(params.provider || '').trim();
    const model = String(params.model || '').trim();
    const originalUserContent = String(params.originalUserContent || '');
    let historyForLlm: LlmMessage[] = (params.historyForLlm || []) as any;
    const baseOptions: Record<string, any> = { ...(params.options || {}), conversationId, messageId: assistantMessageId };
    const hooks = params.runtimeHooks;

    if (!assistantMessageId || !conversationId || !provider || !model) return;

    // 单实例：同一 assistantMessageId 只允许一个 loop
    if (activeLoops.has(assistantMessageId)) return;
    const ctrl = new AbortController();
    activeLoops.set(assistantMessageId, ctrl);

    const attemptByKey = new Map<string, number>();
    const consecutiveEmpty = { n: 0 };

    await setAgentRunState({ assistantMessageId, conversationId, running: true });

    try {
      try {
        await hooks?.onAgentStart?.({ assistantMessageId, conversationId });
      } catch {
        // ignore
      }
      // 强制注入工具定义（agent 模式）
      const { buildMcpSystemInjections } = await import('@/lib/mcp/promptInjector');
      const injection = await buildMcpSystemInjections(originalUserContent || '', conversationId, provider, model, { forceInject: true });

      // 复用工具清单（避免每轮都计算）
      const toolOptions: Record<string, any> = { ...baseOptions };
      if (injection.useNativeTools && injection.nativeTools && injection.nativeTools.length > 0) {
        toolOptions.tools = injection.nativeTools.map((t: any) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }));
        toolOptions.toolChoice = 'auto';
        toolOptions.__useNativeTools = true;
      }

      let round = 0;
      let forceNoTools = false;

      // while(true) agent loop
      while (true) {
        if (isCancelled(assistantMessageId, ctrl.signal)) break;
        round += 1;

        // 进入每一轮 stream 前，确保 message.status=loading（避免 Stop 闪烁）
        await ensureAssistantLoading(assistantMessageId);

        const results = new Map<string, BufferedToolResult>();
        const pending: Promise<void>[] = [];

        const onToolCall: OnToolCall = (req) => {
          const key = String(req.cardId || req.lockKey || req.callId || '').trim() || `${req.server}.${req.tool}:${stableStringify(req.args || {})}`;
          const callId = (req.callId && String(req.callId).trim()) ? String(req.callId).trim() : `call_${key}`.slice(0, 64);

          const p = (async () => {
            if (isCancelled(assistantMessageId, ctrl.signal)) return;
            try {
              if (req.preResult !== undefined) {
                results.set(key, { cardIdOrKey: key, callId, server: req.server, tool: req.tool, args: req.args, result: req.preResult });
                return;
              }

              // 执行工具（不触发旧的 continueWithToolResult 递归续写）
              const inv = new ToolInvocation({
                assistantMessageId,
                conversationId,
                server: req.server,
                tool: req.tool,
                args: req.args || {},
                provider,
                model,
                historyForLlm,
                originalUserContent,
                callId: req.callId,
                cardId: req.cardId,
                lockKey: req.lockKey,
              });
              const out = await DEFAULT_PIPELINE.run(inv);
              results.set(key, { cardIdOrKey: key, callId, server: req.server, tool: req.tool, args: req.args, result: out });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              results.set(key, {
                cardIdOrKey: key,
                callId,
                server: req.server,
                tool: req.tool,
                args: req.args,
                result: { error: 'PIPELINE_FAILED', message: msg },
              });
            } finally {
              try {
                coordinator.markToolCallComplete(req.lockKey, 'completed');
              } catch {
                // ignore
              }
            }
          })();

          pending.push(p);
        };

        const orchestrator = new StreamOrchestrator({
          messageId: assistantMessageId,
          conversationId,
          provider,
          model,
          originalUserContent,
          historyForLlm,
          onUIUpdate: () => {},
          onError: () => {},
          onToolCall,
        });

        const callbacks = orchestrator.createCallbacks();
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
        callbacks.onEvent = async (event: any) => {
          try {
            hooks?.onStreamEvent?.(event, { assistantMessageId, conversationId, round });
          } catch {
            // ignore
          }
          return await (originalOnEvent?.(event) as any);
        };
        const originalOnComplete = callbacks.onComplete;
        callbacks.onComplete = async () => {
          try {
            await (originalOnComplete?.() as any);
          } finally {
            try {
              await hooks?.onStreamComplete?.({ assistantMessageId, conversationId, round });
            } catch {
              // ignore
            }
          }
        };
        const originalOnError = callbacks.onError;
        callbacks.onError = (error: Error) => {
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
        };

        // Loop guard：超过上限时强制本轮不再允许工具
        const options = forceNoTools || round > MAX_RESUME_ROUNDS ? { ...toolOptions, toolChoice: 'none' } : { ...toolOptions };
        let messages: LlmMessage[] = historyForLlm;
        if (forceNoTools || round > MAX_RESUME_ROUNDS) {
          messages = [
            ...messages,
            {
              role: 'system',
              content:
                `你已经尝试了多次但没有成功。请直接用文字回复用户：\n` +
                `- 简单说明你尝试了什么\n` +
                `- 遇到了什么问题\n` +
                `- 建议用户可以怎么做\n\n` +
                `现在请直接回复，不要再调用工具。`,
            } as any,
          ];
        }

        try {
          await streamChat(provider, model, messages, callbacks, options);
        } catch {
          // stream 错误：由 StreamOrchestrator.onError/handleComplete 负责收尾；loop 退出
          break;
        }

        if (isCancelled(assistantMessageId, ctrl.signal)) break;

        // 等待本轮工具（若有）
        if (pending.length === 0) break;
        await Promise.allSettled(pending);

        // 计算熔断（空结果/重复失败）
        let toolLoopTripped = false;
        for (const r of results.values()) {
          const kind = classifyToolResult(r.result);
          const attemptKey = makeAttemptKey({ conversationId, server: r.server, tool: r.tool, args: r.args });
          if (kind === 'empty' || kind === 'tool_error') {
            const next = (attemptByKey.get(attemptKey) || 0) + 1;
            attemptByKey.set(attemptKey, next);
            if (next >= MAX_SAME_ATTEMPTS) toolLoopTripped = true;

            consecutiveEmpty.n += 1;
            if (consecutiveEmpty.n >= MAX_CONSECUTIVE_EMPTY) toolLoopTripped = true;
          } else {
            attemptByKey.delete(attemptKey);
            consecutiveEmpty.n = 0;
          }
        }

        if (toolLoopTripped) {
          forceNoTools = true;
        }

        // 生成 tool_role messages，进入下一轮
        const batch = Array.from(results.values()).sort((a, b) => a.cardIdOrKey.localeCompare(b.cardIdOrKey));
        const { assistantMsg, toolMsgs } = buildToolRoleAppendix(batch);
        historyForLlm = [...historyForLlm, assistantMsg, ...toolMsgs];

        // 若已触发熔断，则让下一轮走一次“纯文本回复”，然后退出
        if (forceNoTools) {
          // 下一轮会 toolChoice=none，stream 完成后 pending 为空，会 break
        }
      }
    } finally {
      activeLoops.delete(assistantMessageId);
      try {
        await hooks?.onAgentEnd?.({ assistantMessageId, conversationId });
      } catch {
        // ignore
      }
      await setAgentRunState({ assistantMessageId, conversationId, running: false });
    }
  }
}

