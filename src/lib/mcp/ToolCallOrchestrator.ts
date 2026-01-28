// 仅保留必要调试输出，不禁用全局 no-console
import { useChatStore } from '@/store/chatStore';
import type { Message as LlmMessage } from '@/lib/llm/types';
import { ToolCallCoordinator } from './ToolCallCoordinator';
import { ToolExecutionPipeline, ToolInvocation } from './pipeline';
import { createDefaultAdapters } from './pipeline/adapters';
import { recordExpectedToolCardId, continueWithToolResult as dispatchFollowUp } from './followup/FollowUpDispatcher';

// #region agent log
const DEBUG_LOG_ENDPOINT = 'http://127.0.0.1:7244/ingest/9f8e7fe1-428e-4909-b4e4-b7238838d737';
function debugLog(location: string, message: string, data?: unknown, hypothesisId?: string) {
  fetch(DEBUG_LOG_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location, message, data, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId }) }).catch(() => {});
}
// #endregion

// 防止重复调用的缓存
const runningCalls = new Map<string, Promise<void>>();

// 全局协调器
const coordinator = ToolCallCoordinator.getInstance();
const DEFAULT_PIPELINE = new ToolExecutionPipeline({ adapters: createDefaultAdapters() });

// multi-tool gate / follow-up 已迁移到 FollowUpDispatcher。

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
    // #region agent log
    debugLog('ToolCallOrchestrator.ts:executeToolCall:invalid', 'Skipping invalid tool call', { server, tool, isInvalidServer, isInvalidTool }, 'H2');
    // #endregion
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
    // #region agent log
    debugLog('ToolCallOrchestrator.ts:executeToolCall:coordinatorSkip', 'Skipping duplicate call via coordinator', { callKey: lockResult.key }, 'H4');
    // #endregion
    return;
  }

  const callKey = lockResult.key;

  // 检查已有的 Promise
  const existingCall = runningCalls.get(callKey);
  if (existingCall) {
    console.log(`[MCP-DEBUG] 跳过重复调用(running): ${callKey}`);
    // #region agent log
    debugLog('ToolCallOrchestrator.ts:executeToolCall:duplicate', 'Skipping duplicate call', { callKey }, 'H4');
    // #endregion
    return existingCall;
  }
  
  // #region agent log
  debugLog('ToolCallOrchestrator.ts:executeToolCall:entry', 'Tool call orchestrator entry', { server, tool, args, cardId, messageId: assistantMessageId }, 'H1');
  // #endregion

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
      // follow-up：让模型读取结果并继续（multi-tool gate 在 continueWithToolResult 内部）
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
  // thin wrapper：真实实现迁移到 FollowUpDispatcher
  return dispatchFollowUp(params as any);
}