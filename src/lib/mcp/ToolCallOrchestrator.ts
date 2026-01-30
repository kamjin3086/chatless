// 仅保留必要调试输出，不禁用全局 no-console
import { useChatStore } from '@/store/chatStore';
import type { Message as LlmMessage } from '@/lib/llm/types';
import { ToolCallCoordinator } from './ToolCallCoordinator';
import { ToolExecutionPipeline, ToolInvocation } from './pipeline';
import { createDefaultAdapters } from './pipeline/adapters';
import type { ToolCallRequest } from '@/lib/llm/types/tool-schema';
import { streamChat } from '@/lib/llm';
import { StreamOrchestrator } from '@/lib/chat/stream/StreamOrchestrator';


// 防止重复调用的缓存
const runningCalls = new Map<string, Promise<void>>();

// 全局协调器
const coordinator = ToolCallCoordinator.getInstance();
const DEFAULT_PIPELINE = new ToolExecutionPipeline({ adapters: createDefaultAdapters() });

// ============================================================
// Strict tool_role AgentLoop (no "继续" user injection)
// - Buffer tool results per assistant message
// - Gate continuation until all expected tool cards for that message are done
// - Resume generation by appending assistant.tool_calls + role=tool messages
// ============================================================
type BufferedToolResult = {
  cardIdOrKey: string;
  callId: string;
  server: string;
  tool: string;
  args?: Record<string, unknown>;
  result: unknown;
};

const bufferedResultsByMessage = new Map<string, Map<string, BufferedToolResult>>();
const expectedToolCardIdsByMessage = new Map<string, Set<string>>();

// Loop guards
const resumeRoundsByMessage = new Map<string, number>();
const attemptByKey = new Map<string, number>();
// 连续空结果计数器（跨不同工具调用，但在同一会话中累计）
const consecutiveEmptyByConversation = new Map<string, number>();
const MAX_RESUME_ROUNDS = 8;
const MAX_SAME_ATTEMPTS = 3;
const MAX_CONSECUTIVE_EMPTY = 3; // 连续 3 次空结果就触发止损

function makeAttemptKey(params: { conversationId: string; server: string; tool: string; args?: Record<string, unknown> }): string {
  return `${params.conversationId}:${params.server}.${params.tool}:${stableStringify(params.args || {})}`;
}

function classifyToolResult(result: unknown): 'success' | 'empty' | 'tool_error' {
  const isEmpty =
    !result ||
    (typeof result === 'string' && result.trim().length === 0) ||
    (Array.isArray(result) && result.length === 0);
  if (isEmpty) return 'empty';

  if (result && typeof result === 'object') {
    const r: any = result as any;
    if (r.error) return 'tool_error';
    if (typeof r.ok === 'boolean' && r.ok === false) return 'tool_error';
    if (typeof r.success === 'boolean' && r.success === false) return 'tool_error';
  }
  return 'success';
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

function recordExpectedToolCardId(assistantMessageId: string, cardIdOrKey: string) {
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

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function summarizeToolOutput(output: unknown): unknown {
  // Keep tool payloads small & stable for context
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

function filterArtifactMessages(messages: LlmMessage[]): LlmMessage[] {
  // Clean legacy artifacts introduced by old FollowUpDispatcher design.
  const out: LlmMessage[] = [];
  for (const m of messages || []) {
    const role = m.role;
    const content = String((m as any)?.content ?? '');
    if (role === 'user') {
      const t = content.trim();
      if (
        t === '继续：基于上述工具结果完成用户最初的请求。' ||
        t === '工具调用已完成，请继续。' ||
        t === '继续：基于上述工具结果完成用户最初的请求。' // duplicated safeguard
      ) {
        continue;
      }
    }
    if (role === 'system') {
      if (
        content.startsWith('【Follow-up 指引】') ||
        content.startsWith('【历史工具输出（降级文本') ||
        content.startsWith('【防死循环】')
      ) {
        continue;
      }
    }
    out.push(m);
  }
  return out;
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

async function resumeAssistantWithToolRole(params: {
  assistantMessageId: string;
  provider: string;
  model: string;
  conversationId: string;
  historyForLlm: LlmMessage[];
  originalUserContent: string;
  batch: BufferedToolResult[];
  toolLoopTripped?: boolean;
}) {
  const { assistantMessageId, provider, model, conversationId, historyForLlm, originalUserContent, batch, toolLoopTripped } = params;

  // Prevent overlapping continuations
  if (!coordinator.tryAcquireFollowupLock(assistantMessageId, 500)) return;
  if (coordinator.isMessageCancelled(assistantMessageId)) return;

  // Round guard: prevent infinite tool loops even if model keeps emitting tool_calls
  const nextRound = (resumeRoundsByMessage.get(assistantMessageId) || 0) + 1;
  resumeRoundsByMessage.set(assistantMessageId, nextRound);

  const cleanedHistory = filterArtifactMessages(historyForLlm || []);
  const { assistantMsg, toolMsgs } = buildToolRoleAppendix(batch);
  let messages: LlmMessage[] = [...cleanedHistory, assistantMsg, ...toolMsgs];

  const orchestrator = new StreamOrchestrator({
    messageId: assistantMessageId,
    conversationId,
    provider,
    model,
    originalUserContent,
    historyForLlm: messages,
    onUIUpdate: () => {},
    onError: (error) => {
      console.error('[ToolCallOrchestrator] resume failed:', error);
      const store = useChatStore.getState();
      store.updateMessage(assistantMessageId, { status: 'error' });
    },
  });
  const streamCallbacks = orchestrator.createCallbacks();

  // Inject native tool definitions via options (system prompt already present in historyForLlm)
  const { buildMcpSystemInjections } = await import('@/lib/mcp/promptInjector');
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

  // If loop guard is tripped, force the model to finish without further tool calls.
  if (toolLoopTripped || nextRound > MAX_RESUME_ROUNDS) {
    messages = [
      ...messages,
      {
        role: 'system',
        content:
          `【止损】检测到以下问题之一：` +
          `(1) 工具回合达到上限（${MAX_RESUME_ROUNDS}次）；` +
          `(2) 同一调用重复失败（${MAX_SAME_ATTEMPTS}次）；` +
          `(3) 连续${MAX_CONSECUTIVE_EMPTY}次工具调用返回空结果。\n\n` +
          `现在禁止继续调用工具。请：\n` +
          `1. 向用户解释你尝试了什么、遇到了什么问题\n` +
          `2. 给出你目前能给出的最佳结论\n` +
          `3. 告知用户需要补充什么信息或采取什么操作`,
      } as any,
    ];
    // Keep tools list but force none; some OpenAI-compatible backends require tools to coexist with tool_choice.
    options.toolChoice = 'none';
  }

  await streamChat(provider, model, messages, streamCallbacks, options);
}

export async function executeToolCall(params: {
  assistantMessageId: string;
  conversationId: string;
  server: string;
  tool: string;
  args?: Record<string, unknown>;
  provider: string;
  model: string;
  historyForLlm: LlmMessage[];
  originalUserContent: string;
  callId?: string;
  cardId?: string;
  lockKey?: string;
}): Promise<void> {
  const { assistantMessageId, conversationId, server, tool, args, provider, model, historyForLlm, originalUserContent, callId, cardId, lockKey } = params;
  
  // 过滤无效/错误解析的工具调用（提前检查，减少日志噪音）
  const isInvalidServer = !server || server === 'unknown' || server.includes('use_mcp_tool') || server.includes('>');
  const isInvalidTool = !tool || tool === 'unknown';
  if (isInvalidServer || isInvalidTool) {

    return;
  }
  
  // 防重复调用：使用统一协调器
  const lockResult = lockKey
    ? { acquired: true, key: lockKey }
    : coordinator.tryAcquireToolCallLock({
        messageId: assistantMessageId,
        server,
        tool,
        args,
        callId,
        cardId,
        source: 'execute',
      });

  if (!lockResult.acquired) {
    console.log(`[MCP-DEBUG] 跳过重复调用(coordinator): ${lockResult.key}`);

    return;
  }

  const callKey = lockResult.key;

  // 检查已有的 Promise
  const existingCall = runningCalls.get(callKey);
  if (existingCall) {
    console.log(`[MCP-DEBUG] 跳过重复调用(running): ${callKey}`);

    return existingCall;
  }


  // 记账：本 message 实际启动的 toolCard（用于 multi-tool gate）
  // 注意：这里用 cardId（若存在）作为唯一键，确保 expectedCount 稳定。
  try {
    const id = String(cardId || callKey || callId || '');
    if (id) {
      recordExpectedToolCardId(assistantMessageId, id);
    }
  } catch { /* noop */ }

  const DEBUG_MCP = false;
  if (DEBUG_MCP) { try { console.log('[MCP-ORCH] start', assistantMessageId, server, tool); } catch { /* noop */ } }

  // 关键修复：进入工具阶段即标记当前助手消息为 loading，保证停止按钮持续可见
  try {
    const st0 = useChatStore.getState();
    const conv0 = st0.conversations.find(c => c.id === conversationId);
    const msg0: any = conv0?.messages.find(m => m.id === assistantMessageId);
    // 仅当用户“停止整条 agent”（cancelMessage）时才中断；工具本身报错不应阻断后续工具卡
    if (!msg0 || coordinator.isMessageCancelled(assistantMessageId)) {
      coordinator.markToolCallComplete(callKey, 'failed');
      return;
    }
    // 确保 loading 状态维持期间停止按钮可见
    void st0.updateMessage(assistantMessageId, { status: 'loading' });
  } catch { /* noop */ }

  const effectiveTool = (server === 'filesystem' && tool === 'list') ? 'dir' : tool;
  const effectiveArgs = normalizeArgs(server, args || {});

  // 重复调用检查移至授权判定之后，避免绕过授权开关

  // —— 统一管线：全部进入 ToolExecutionPipeline（web_search 已纳入 WebSearchAdapter）——
  const executePromise = (async () => {
    const inv = new ToolInvocation({
      assistantMessageId,
      conversationId,
      server,
      tool: effectiveTool,
      args: effectiveArgs,
      provider,
      model,
      historyForLlm,
      originalUserContent,
      callId,
      cardId,
      lockKey: callKey,
    });
    try {
      const result = await DEFAULT_PIPELINE.run(inv);
      // 若该卡片已被用户“停止/跳过”，则不要触发 follow-up（由 UI 侧合成触发，避免重复）
      try {
        if (coordinator.isToolCardCancelled(assistantMessageId, String(inv.cardId || ''))) {
          return;
        }
      } catch { /* noop */ }
      await continueWithToolResult({
        assistantMessageId,
        provider,
        model,
        conversationId,
        historyForLlm,
        originalUserContent,
        server,
        tool: effectiveTool,
        args: effectiveArgs,
        cardId: inv.cardId,
        callId,
        result,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await continueWithToolResult({
        assistantMessageId,
        provider,
        model,
        conversationId,
        historyForLlm,
        originalUserContent,
        server,
        tool: effectiveTool,
        args: effectiveArgs,
        cardId: inv.cardId,
        callId,
        result: { error: 'PIPELINE_FAILED', message: msg },
      });
    } finally {
      runningCalls.delete(callKey);
      coordinator.markToolCallComplete(callKey, 'completed');
    }
  })();

  runningCalls.set(callKey, executePromise);
  return executePromise;
}

function normalizeArgs(srv: string, originalArgs: Record<string, unknown>) {
  const a: Record<string, unknown> & { path?: string } = { ...(originalArgs || {}) };
  // Filesystem: 统一路径分隔符
  if (srv === 'filesystem' && typeof a.path === 'string') {
    a.path = a.path.replace(/\\/g, '/');
  }
  return a;
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
    historyForLlm,
    originalUserContent,
    server,
    tool,
    args,
    cardId,
    callId,
    result,
  } = params;

  if (coordinator.isMessageCancelled(assistantMessageId)) return;

  // Failure circuit breaker (same tool+args)
  const kind = classifyToolResult(result);
  const attemptKey = makeAttemptKey({ conversationId, server, tool, args });
  let toolLoopTripped = false;
  
  if (kind === 'empty' || kind === 'tool_error') {
    // 1) 同一工具+参数的重复调用计数
    const next = (attemptByKey.get(attemptKey) || 0) + 1;
    attemptByKey.set(attemptKey, next);
    if (next >= MAX_SAME_ATTEMPTS) toolLoopTripped = true;
    
    // 2) 连续空结果计数（跨不同工具调用）
    const consecutiveEmpty = (consecutiveEmptyByConversation.get(conversationId) || 0) + 1;
    consecutiveEmptyByConversation.set(conversationId, consecutiveEmpty);
    if (consecutiveEmpty >= MAX_CONSECUTIVE_EMPTY) {
      toolLoopTripped = true;
      console.log(`[MCP-DEBUG] 连续空结果达到上限 (${consecutiveEmpty}/${MAX_CONSECUTIVE_EMPTY}), conversationId=${conversationId}`);
    }
  } else {
    attemptByKey.delete(attemptKey);
    // 成功后重置连续空结果计数
    consecutiveEmptyByConversation.delete(conversationId);
  }

  // Buffer this tool result (for multi-tool gating)
  const bufKey =
    (cardId && String(cardId).trim()) ||
    (callId && String(callId).trim()) ||
    `${server}.${tool}:${stableStringify(args || {})}`;
  const effectiveCallId = (callId && String(callId).trim()) ? String(callId).trim() : `call_${bufKey}`.slice(0, 64);

  let buf = bufferedResultsByMessage.get(assistantMessageId);
  if (!buf) {
    buf = new Map();
    bufferedResultsByMessage.set(assistantMessageId, buf);
  }
  buf.set(bufKey, {
    cardIdOrKey: bufKey,
    callId: effectiveCallId,
    server,
    tool,
    args,
    result,
  });

  // Gate: wait until all expected tool cards are finished (if known)
  const expected = expectedToolCardIdsByMessage.get(assistantMessageId);
  const expectedCount = expected ? expected.size : 0;
  const bufferedCount = buf.size;
  const shouldGate = expectedCount > 1;
  const shouldProceed = !shouldGate || bufferedCount >= expectedCount;
  if (!shouldProceed) return;

  const batch = Array.from((bufferedResultsByMessage.get(assistantMessageId) || new Map()).values());
  bufferedResultsByMessage.delete(assistantMessageId);
  expectedToolCardIdsByMessage.delete(assistantMessageId);

  await resumeAssistantWithToolRole({
    assistantMessageId,
    provider,
    model,
    conversationId,
    historyForLlm,
    originalUserContent,
    batch,
    toolLoopTripped,
  });
}
