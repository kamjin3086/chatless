import { useChatStore } from '@/store/chatStore';
import { streamChat } from '@/lib/llm';
import { StreamOrchestrator } from '@/lib/chat/stream/StreamOrchestrator';
import type { Message as LlmMessage } from '@/lib/llm/types';
import { ToolCallCoordinator } from '@/lib/mcp/ToolCallCoordinator';

import { ConversationEventLog } from '@/lib/mcp/pipeline/context/ConversationEventLog';
import { ContextWindowManager } from '@/lib/mcp/pipeline/context/ContextWindowManager';

type BufferedToolResult = {
  cardIdOrKey: string;
  callId?: string;
  server: string;
  tool: string;
  args?: Record<string, unknown>;
  result: unknown;
};

const bufferedResultsByMessage = new Map<string, Map<string, BufferedToolResult>>();
const expectedToolCardIdsByMessage = new Map<string, Set<string>>();
const contextWindowManager = new ContextWindowManager();
const coordinator = ToolCallCoordinator.getInstance();

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

export function recordExpectedToolCardId(assistantMessageId: string, cardIdOrKey: string) {
  try {
    const id = String(cardIdOrKey || '').trim();
    if (!id) return;
    const set = expectedToolCardIdsByMessage.get(assistantMessageId) || new Set<string>();
    set.add(id);
    expectedToolCardIdsByMessage.set(assistantMessageId, set);
  } catch {
    /* noop */
  }
}

export async function continueWithToolResult(params: {
  assistantMessageId: string;
  provider: string;
  model: string;
  conversationId: string;
  historyForLlm: LlmMessage[];
  originalUserContent: string;
  server: string;
  tool: string;
  args?: Record<string, unknown>;
  cardId?: string;
  callId?: string;
  result: unknown;
}) {
  const {
    assistantMessageId,
    provider,
    model,
    conversationId,
    originalUserContent,
    server,
    tool,
    args,
    cardId,
    callId,
    result,
  } = params;

  if (coordinator.isMessageCancelled(assistantMessageId)) {
    return;
  }

  // ========= 多工具批处理：先缓存本次工具结果（用于合并多查询）=========
  // 关键：follow-up 的上下文来源要“纯”，避免依赖 UI store 的 segments 时序。
  // 因此这里严格优先使用 cardId，其次使用 callId；只有都没有才回退到 server/tool/args。
  const bufKey =
    (cardId && String(cardId).trim()) ||
    (callId && String(callId).trim()) ||
    `${server}.${tool}:${stableStringify(args || {})}`;
  let buf = bufferedResultsByMessage.get(assistantMessageId);
  if (!buf) {
    buf = new Map();
    bufferedResultsByMessage.set(assistantMessageId, buf);
  }
  buf.set(bufKey, { cardIdOrKey: bufKey, callId, server, tool, args, result });

  // ========= gate（expectedCount vs bufferedCount）=========
  try {
    const expected = expectedToolCardIdsByMessage.get(assistantMessageId);
    const expectedCount = expected ? expected.size : 0;
    const bufferedCount = buf.size;
    const shouldGate = expectedCount > 1;
    const shouldProceed = !shouldGate || bufferedCount >= expectedCount;
    if (!shouldProceed) return;
  } catch {
    /* noop */
  }

  const batch = Array.from((bufferedResultsByMessage.get(assistantMessageId) || new Map()).values());
  // 清理本批次缓存，避免重复触发与内存泄漏
  bufferedResultsByMessage.delete(assistantMessageId);
  expectedToolCardIdsByMessage.delete(assistantMessageId);

  // 统一 follow-up 指引（多工具：逐条生成并合并）
  const { GuidanceResolver, classifyToolResult } = await import('./GuidanceResolver');
  const instructionParts: string[] = [];
  for (const r of batch) {
    const k = classifyToolResult(r.result);
    const one = GuidanceResolver.getInstance().resolve({
      phase: 'tool_result',
      server: r.server,
      tool: r.tool,
      args: (r.args || {}) as Record<string, unknown>,
      result: r.result,
      kind: k,
    });
    if (one) instructionParts.push(one);
  }
  const instruction = instructionParts.filter(Boolean).join('\n\n');

  // 构建 event log -> messages（优先 tool_role；失败时降级 text_wrapper）
  const store = useChatStore.getState();

  const log = new ConversationEventLog();
  for (const m of params.historyForLlm || []) {
    if (m.role === 'user') log.appendUserMessage(m.content);
    else if (m.role === 'assistant') log.appendAssistantMessage(m.content);
    else if (m.role === 'system' || m.role === 'developer') log.appendContextChange('other', m.content);
    else if (m.role === 'tool') {
      // 历史里已存在 tool message（极少见），直接当作“已完成的 tool output”写入 wrapper 以避免丢信息
      log.appendToolCallOutput({ server: 'unknown', tool: 'unknown', args: {}, output: m.content, callId: m.tool_call_id });
    } else {
      log.appendContextChange('other', m.content);
    }
  }

  for (const r of batch) {
    log.appendToolCallRequested({
      callId: r.callId,
      server: r.server,
      tool: r.tool,
      args: r.args || {},
      cardId: r.cardIdOrKey,
    });
  }
  for (const r of batch) {
    log.appendToolCallOutput({
      callId: r.callId,
      server: r.server,
      tool: r.tool,
      args: r.args || {},
      output: r.result,
      isError: false,
      cardId: r.cardIdOrKey,
    });
  }

  // 用一个轻量 user 指令触发继续（不再把结果拼进 user 文本）
  log.appendUserMessage(
    instruction ||
      `工具调用已完成。请基于工具返回的结果继续回答用户问题；如仍不足，可继续调用工具补齐（注意预算与去重）。`
  );

  const hasCallIds = batch.length > 0 && batch.every((r) => !!(r.callId && String(r.callId).trim()));
  let providerSupportsToolRole = false;
  try {
    const { shouldUseNativeToolCalls } = await import('@/lib/llm/types/tool-capability');
    providerSupportsToolRole = !!shouldUseNativeToolCalls(provider, model);
  } catch {
    // 保守：无法判断时不启用 tool_role（避免旧 provider 报错）
    providerSupportsToolRole = false;
  }

  const canUseToolRole = hasCallIds && providerSupportsToolRole;

  let followUpMessages = log.renderForModel(canUseToolRole ? 'tool_role' : 'text_wrapper');
  followUpMessages = await contextWindowManager.compact(followUpMessages, {
    provider,
    model,
    maxInputTokens: 9000,
    keepLastN: 24,
    allowSummarize: false,
  });

  const followUpUserContent = instruction || `工具调用已完成，请继续。`;

  const runFollowUp = async (messages: LlmMessage[]) => {
    const orchestrator = new StreamOrchestrator({
      messageId: assistantMessageId,
      conversationId,
      provider,
      model,
      originalUserContent: followUpUserContent,
      historyForLlm: messages,
      onUIUpdate: () => {},
      onError: (error) => {
        console.error('[FollowUpDispatcher] follow-up failed:', error);
        store.updateMessage(assistantMessageId, { status: 'error' });
      },
    });

    const streamCallbacks = orchestrator.createCallbacks();

    const { buildMcpSystemInjections } = await import('../promptInjector');
    const injection = await buildMcpSystemInjections(originalUserContent || '', conversationId, provider, model, {
      forceInject: true,
    });

    const options: Record<string, any> = { conversationId, messageId: assistantMessageId };
    if (injection.useNativeTools && injection.nativeTools && injection.nativeTools.length > 0) {
      options.tools = injection.nativeTools.map((t: any) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
      options.toolChoice = 'auto';
      options.__useNativeTools = true;
    }

    await streamChat(provider, model, messages, streamCallbacks, options);
  };

  try {
    await runFollowUp(followUpMessages);
  } catch {
    // 部分 OpenAI-compat 后端会校验 tool_call_id 与 tool_calls，上层兼容回退
    try {
      const fallback = await contextWindowManager.compact(log.renderForModel('text_wrapper'), {
        provider,
        model,
        maxInputTokens: 9000,
        keepLastN: 24,
        allowSummarize: false,
      });
      await runFollowUp(fallback);
    } catch (e2) {
      console.error('[FollowUpDispatcher] Failed to trigger follow-up:', e2);
    }
  }
}

