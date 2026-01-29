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

// 防止 follow-up 死循环：对“同一 tool + 同一关键参数”的重复失败/空结果做熔断
const attemptByKey = new Map<string, number>();
const MAX_SAME_ATTEMPTS = 3;

function makeAttemptKey(params: { conversationId: string; server: string; tool: string; args?: Record<string, unknown> }): string {
  return `${params.conversationId}:${params.server}.${params.tool}:${stableStringify(params.args || {})}`;
}

function summarizeToolOutput(server: string, tool: string, output: unknown): unknown {
  // 对模型：优先给“可读摘要”，避免塞入超长 JSON 导致上下文爆炸
  try {
    if (typeof output === 'string') {
      const s = output;
      if (s.length > 4000) return `${s.slice(0, 4000)}\n... (truncated, ${s.length} chars)`;
      return s;
    }
    if (Array.isArray(output)) {
      const arr = output as any[];
      if (arr.length <= 60) return output;
      return {
        summary: `Array(${arr.length}) truncated`,
        head: arr.slice(0, 30),
        tail: arr.slice(-10),
      };
    }
    // 目录列表常见字段：name/path/isDirectory...
    if (output && typeof output === 'object') {
      const str = JSON.stringify(output);
      if (str.length > 8000) {
        return { summary: `Object truncated (${str.length} chars)`, preview: str.slice(0, 8000) };
      }
    }
  } catch {
    // ignore
  }
  return output;
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
  let toolLoopTripped = false;
  for (const r of batch) {
    const k = classifyToolResult(r.result);
    // 熔断：同一 tool 调用连续失败/空结果最多 3 次
    const attemptKey = makeAttemptKey({ conversationId, server: r.server, tool: r.tool, args: r.args });
    if (k === 'empty' || k === 'tool_error' || k === 'connection_error') {
      const next = (attemptByKey.get(attemptKey) || 0) + 1;
      attemptByKey.set(attemptKey, next);
      if (next >= MAX_SAME_ATTEMPTS) {
        toolLoopTripped = true;
      }
    } else if (k === 'success') {
      // 成功则清零计数（避免跨步骤误触发熔断）
      attemptByKey.delete(attemptKey);
    }
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
      // ⚠️ 重要：历史 tool message 可能缺少上游 assistant.tool_calls（OpenAI tool 协议要求），
      // 若直接注入为 role=tool 会产生“不合法 messages 序列”并导致 LM Studio/模型异常。
      // 因此这里降级为普通上下文文本（system），避免生成 orphan tool 消息。
      const content = [
        '【历史工具输出（降级文本，避免 tool 协议不一致）】',
        `tool_call_id: ${(m as any).tool_call_id || '(none)'}`,
        `content: ${String(m.content || '')}`,
      ].join('\n');
      log.appendContextChange('other', content);
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
      output: summarizeToolOutput(r.server, r.tool, r.result),
      isError: false,
      cardId: r.cardIdOrKey,
    });
  }

  // ⚠️ Follow-up 指引不应作为“用户消息”注入（会被模型当作用户需求而无限重试）。
  // 改为 system 上下文提示 + 一个轻量 user 触发继续。
  if (instruction) {
    log.appendContextChange('other', `【Follow-up 指引】\n${instruction}`);
  }
  log.appendUserMessage('继续：基于上述工具结果完成用户最初的请求。');

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
      options.toolChoice = toolLoopTripped ? 'none' : 'auto';
      options.__useNativeTools = true;
    }

    if (toolLoopTripped) {
      // 强制停止工具循环：让模型直接总结已知信息并给出下一步建议
      messages = [
        ...messages,
        {
          role: 'system',
          content:
            `【防死循环】检测到同一工具调用重复失败/空结果已达到上限（${MAX_SAME_ATTEMPTS}次）。` +
            `现在禁止继续工具调用；请直接给出当前能给出的最佳结论，并明确需要用户补充哪些信息/采取哪些操作。`,
        } as any,
      ];
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

