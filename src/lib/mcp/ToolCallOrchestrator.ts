// 仅保留必要调试输出，不禁用全局 no-console
import { useChatStore } from '@/store/chatStore';
import { streamChat } from '@/lib/llm';
import { mcpCallHistory } from './callHistory';
import type { Message as LlmMessage, StreamCallbacks } from '@/lib/llm/types';
import { DEFAULT_MAX_TOOL_RECURSION_DEPTH } from './constants';
import StorageUtil from '@/lib/storage';
import { shouldAutoAuthorize } from './authorizationConfig';
import { useAuthorizationStore } from '@/store/authorizationStore';
import { WEB_SEARCH_SERVER_NAME } from './nativeTools/webSearch';
import { filterToolCallContent } from '@/lib/chat/segments';
import { ToolCallCoordinator } from './ToolCallCoordinator';
import { filterForDisplay, filterToolInstructions } from '@/lib/mcp/toolInstruction';

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

// ============================================================
// 多工具批处理（同一条 assistant 消息内的多次工具调用）
// - 问题：每个 TOOL_RESULT 都会尝试触发 follow-up，但 follow-up 锁会让后续结果被抛弃
// - 方案：缓存本批次 tool results，等全部完成后触发一次 follow-up，并合并结果喂给模型
// ============================================================
type BufferedToolResult = {
  cardIdOrKey: string;
  server: string;
  tool: string;
  args?: Record<string, unknown>;
  result: unknown;
};

const bufferedResultsByMessage = new Map<string, Map<string, BufferedToolResult>>();
const processedToolCardIdsByMessage = new Map<string, Set<string>>();
// 记录“本条 assistant message 实际启动了多少个 toolCard（去重后）”，用于稳健 gate：
// 避免依赖 UI segments 状态时序导致提前触发 follow-up（只喂到 1 条结果）。
const expectedToolCardIdsByMessage = new Map<string, Set<string>>();

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
      const set = expectedToolCardIdsByMessage.get(assistantMessageId) || new Set<string>();
      set.add(id);
      expectedToolCardIdsByMessage.set(assistantMessageId, set);
    }
  } catch { /* noop */ }

  const DEBUG_MCP = false;
  if (DEBUG_MCP) { try { console.log('[MCP-ORCH] start', assistantMessageId, server, tool); } catch { /* noop */ } }

  // 关键修复：进入工具阶段即标记当前助手消息为 loading，保证停止按钮持续可见
  try {
    const st0 = useChatStore.getState();
    const conv0 = st0.conversations.find(c => c.id === conversationId);
    const msg0: any = conv0?.messages.find(m => m.id === assistantMessageId);
    // 若用户已停止（被标记为 error），则不再继续后续链路
    if (!msg0 || msg0.status === 'error') {
      coordinator.markToolCallComplete(callKey, 'failed');
      return;
    }
    // 确保 loading 状态维持期间停止按钮可见
    void st0.updateMessage(assistantMessageId, { status: 'loading' });
  } catch { /* noop */ }

  const effectiveTool = (server === 'filesystem' && tool === 'list') ? 'dir' : tool;
  const effectiveArgs = normalizeArgs(server, args || {});

  // 重复调用检查移至授权判定之后，避免绕过授权开关

  // —— 原生工具拦截：web_search ——（加入授权判定与缓存复用）
  if (server === WEB_SEARCH_SERVER_NAME) {
    const executeNative = (async () => {
      try {
        // 授权检查（不可绕过）
        const autoAuth = await shouldAutoAuthorize(server);
        if (!autoAuth) {
          const effectiveCardId = cardId || crypto.randomUUID();
          const st = useChatStore.getState();
          if (!cardId) {
            st.dispatchMessageAction(assistantMessageId, { 
              type: 'TOOL_RESULT', 
              server, 
              tool: effectiveTool, 
              ok: false, 
              errorMessage: 'pending_auth',
              cardId: effectiveCardId 
            });
          }
          const authorized = await new Promise<boolean>((resolve) => {
            const authStore = useAuthorizationStore.getState();
            authStore.addPendingAuthorization({
              id: effectiveCardId,
              messageId: assistantMessageId,
              server,
              tool: effectiveTool,
              args: effectiveArgs || {},
              createdAt: Date.now(),
              onApprove: () => resolve(true),
              onReject: () => resolve(false)
            });
          });
          if (!authorized) {
            st.dispatchMessageAction(assistantMessageId, { 
              type: 'TOOL_RESULT', 
              server, 
              tool: effectiveTool, 
              ok: false, 
              errorMessage: '用户拒绝授权此工具调用',
              cardId: effectiveCardId 
            });
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
              result: {
                error: 'AUTHORIZATION_DENIED',
                message: '用户拒绝了此工具调用。这可能是因为用户认为此调用不合理或参数有误。'
              }
            });
            return;
          }
        }

        // 授权通过后再尝试使用缓存结果
        if (mcpCallHistory.isDuplicateCall(server, effectiveTool, effectiveArgs)) {
          const recent = mcpCallHistory.getRecentResult(server, effectiveTool, effectiveArgs);
          if (recent) {
            const st = useChatStore.getState();
            const resultPreview = typeof recent === 'string' ? recent.slice(0, 12000) : JSON.stringify(recent).slice(0, 12000);
            st.dispatchMessageAction(assistantMessageId, { type: 'TOOL_RESULT', server, tool: effectiveTool, ok: true, resultPreview, cardId });
            await continueWithToolResult({ assistantMessageId, provider, model, conversationId, historyForLlm, originalUserContent, server, tool: effectiveTool, args: effectiveArgs, result: recent });
            return;
          }
        }

        // 使用WebSearchExecutor处理所有web_search工具调用
        const { WebSearchExecutor } = await import('./executor/WebSearchExecutor');
        const executor = new WebSearchExecutor(
          {
            assistantMessageId,
            conversationId,
            server,
            tool: effectiveTool,
            args: effectiveArgs,
            provider,
            model,
            historyForLlm,
            originalUserContent,
            cardId,
          },
          callKey
        );
        await executor.execute();
      } catch (e) {
        console.error('[WEB_SEARCH] executor error:', e);
      } finally {
        runningCalls.delete(callKey);
        coordinator.markToolCallComplete(callKey, 'completed');
      }
    })();
    runningCalls.set(callKey, executeNative);
    return executeNative;
  }

  // —— Skill 工具拦截 ——
  // 检查是否为 skill 内置工具（如 get_skill_instructions）
  // 支持两种调用方式：
  // 1. server='skills', tool='get_skill_instructions'
  // 2. 直接 tool='get_skill_instructions'
  const { isSkillTool, executeSkillTool } = await import('@/lib/skills/skillTools');
  const isSkillServer = server === 'skills' || server === 'skill';
  if (isSkillServer || isSkillTool(effectiveTool)) {
    const executeSkill = (async () => {
      try {
        // #region agent log
        debugLog('ToolCallOrchestrator.ts:executeToolCall:skillTool', 'Executing skill tool', { tool: effectiveTool, args: effectiveArgs }, 'H5');
        // #endregion
        
        // 执行 skill 工具
        const result = await executeSkillTool(effectiveTool, effectiveArgs);
        
        // 更新工具卡片为成功状态
        const st = useChatStore.getState();
        const effectiveCardId = cardId || crypto.randomUUID();
        st.dispatchMessageAction(assistantMessageId, {
          type: 'TOOL_RESULT',
          server: server || 'skills',
          tool: effectiveTool,
          ok: true,
          data: result,
          cardId: effectiveCardId,
        });
        
        // 继续对话，让 AI 处理 skill 指令的结果
        await continueWithToolResult({
          assistantMessageId,
          provider,
          model,
          conversationId,
          historyForLlm,
          originalUserContent,
          server: server || 'skills',
          tool: effectiveTool,
          args: effectiveArgs,
          result,
        });
      } catch (e) {
        console.error('[SKILL] tool error:', e);
        const st = useChatStore.getState();
        const effectiveCardId = cardId || crypto.randomUUID();
        st.dispatchMessageAction(assistantMessageId, {
          type: 'TOOL_RESULT',
          server: server || 'skills',
          tool: effectiveTool,
          ok: false,
          errorMessage: e instanceof Error ? e.message : 'Skill tool execution failed',
          cardId: effectiveCardId,
        });
      } finally {
        runningCalls.delete(callKey);
        coordinator.markToolCallComplete(callKey, 'completed');
      }
    })();
    runningCalls.set(callKey, executeSkill);
    return executeSkill;
  }

  // —— MCP工具执行：使用McpToolExecutor ——
  const { McpToolExecutor } = await import('./executor/McpToolExecutor');
  const executor = new McpToolExecutor({
    assistantMessageId,
    conversationId,
    server,
    tool: effectiveTool,
    args: effectiveArgs,
    provider,
    model,
    historyForLlm,
    originalUserContent,
    cardId,
  }, callKey);
  
  const executePromise = (async () => {
    try {
      await executor.execute();
    } catch (e) {
      // McpToolExecutor内部已处理所有错误
      console.error('[MCP] executor error:', e);
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

function extractToolResultMessage(content: string): { toolRef: string; payload: string } | null {
  try {
    const text = String(content || '');
    const m = text.match(/下面是刚刚调用\s+([a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)\s+得到的结果/);
    if (!m) return null;
    const toolRef = m[1];
    const afterHeaderIdx = text.indexOf('：', m.index);
    const afterHeader = afterHeaderIdx >= 0 ? text.slice(afterHeaderIdx + 1) : text;
    const cutAt = (() => {
      const i1 = afterHeader.indexOf('请你先认真阅读这些结果');
      const i2 = afterHeader.indexOf('—— 追加说明 ——');
      const i3 = afterHeader.indexOf('【回答策略】');
      const candidates = [i1, i2, i3].filter((n) => n >= 0);
      return candidates.length ? Math.min(...candidates) : -1;
    })();
    const payload = (cutAt >= 0 ? afterHeader.slice(0, cutAt) : afterHeader).trim();
    if (!payload) return null;
    return { toolRef, payload };
  } catch {
    return null;
  }
}

function collapseToolResultUserMessages(history: LlmMessage[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  const toolPieces: Array<{ toolRef: string; payload: string }> = [];

  for (const m of history || []) {
    if ((m as any)?.role === 'user') {
      const hit = extractToolResultMessage(String((m as any)?.content || ''));
      if (hit) {
        toolPieces.push(hit);
        continue;
      }
    }
    out.push(m);
  }

  if (toolPieces.length <= 1) return history;

  const parts = toolPieces.slice(-8).map((p, i) => {
    const payload = p.payload.replace(/\n{4,}/g, '\n\n').slice(0, 1200);
    return `【${i + 1}/${toolPieces.length}】${p.toolRef}\n${payload}`;
  });
  const merged = `【工具结果汇总】共 ${toolPieces.length} 次调用（仅保留必要片段）\n\n${parts.join('\n\n---\n\n')}`;

  // #region agent log
  debugLog(
    'ToolCallOrchestrator.ts:collapseToolResultUserMessages',
    'Collapsed tool-result user messages',
    { before: history.length, after: out.length + 1, toolPieces: toolPieces.length },
    'H-MERGE'
  );
  // #endregion

  return [...out, { role: 'user', content: merged } as any];
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
  result: unknown;
}) {
  const { assistantMessageId, provider, model, conversationId, historyForLlm, originalUserContent, server, tool, args, result } = params;

  // #region agent log
  debugLog(
    'ToolCallOrchestrator.ts:continueWithToolResult:entry',
    'continueWithToolResult entered',
    {
      assistantMessageId,
      conversationId,
      provider,
      model,
      server,
      tool,
      resultType: result === null ? 'null' : Array.isArray(result) ? 'array' : typeof result,
      resultArrayLen: Array.isArray(result) ? result.length : undefined,
    },
    'H-A'
  );
  // #endregion
  
  const key = conversationId;
  const counterKey = `mcp-recursion-${key}`;
  // 注意：follow-up 锁与递归计数要在“确认真的要进入追问”之后再获取/递增。
  // 否则“并行工具批次中的中间 TOOL_RESULT”会提前消耗预算并把真正的追问 debounced 掉。

  // ========= 多工具批处理：先缓存本次工具结果（用于合并多查询）=========
  let matchedCardId: string | undefined;
  try {
    const st0 = useChatStore.getState();
    const conv0 = st0.conversations.find((c) => c.id === conversationId);
    const msg0: any = conv0?.messages.find((m) => m.id === assistantMessageId);
    const segs0 = Array.isArray(msg0?.segments) ? msg0.segments : [];
    const toolCards0 = segs0.filter((s: any) => s?.kind === 'toolCard');
    const argsKey = stableStringify(args || {});
    const hit = toolCards0.find(
      (c: any) => c?.server === server && c?.tool === tool && stableStringify(c?.args || {}) === argsKey
    );
    if (hit?.id) matchedCardId = String(hit.id);
  } catch { /* noop */ }

  const bufKey = matchedCardId || `${server}.${tool}:${stableStringify(args || {})}`;
  let buf = bufferedResultsByMessage.get(assistantMessageId);
  if (!buf) {
    buf = new Map();
    bufferedResultsByMessage.set(assistantMessageId, buf);
  }
  buf.set(bufKey, { cardIdOrKey: bufKey, server, tool, args, result });

  // #region agent log
  debugLog(
    'ToolCallOrchestrator.ts:continueWithToolResult:multiBuffer',
    'Buffered tool result for multi-tool batch',
    { assistantMessageId, bufKey, matchedCardId: matchedCardId || null, bufferedCount: buf.size },
    'H_MULTI'
  );
  // #endregion
  // ========= /多工具批处理 =========

  // ========= 关键：稳健 gate（expectedCount vs bufferedCount）=========
  // 避免“第一条 TOOL_RESULT 抢 follow-up 锁并提前发起追问”，导致只喂到 1 条结果。
  try {
    const expected = expectedToolCardIdsByMessage.get(assistantMessageId);
    const expectedCount = expected ? expected.size : 0;
    const bufferedCount = buf.size;
    const shouldGate = expectedCount > 1;
    const shouldProceed = !shouldGate || bufferedCount >= expectedCount;

    // #region agent log
    debugLog(
      'ToolCallOrchestrator.ts:continueWithToolResult:gateCheck',
      'Gate check before follow-up (expected vs buffered)',
      { assistantMessageId, expectedCount, bufferedCount, shouldGate, shouldProceed },
      'H_MULTI'
    );
    // #endregion

    if (!shouldProceed) return;
  } catch { /* noop */ }
  // ========= /稳健 gate =========

  // 根据结果类型生成精准的追问提示
  const isError = typeof result === 'object' && result && (result as any).error;
  const isEmptyResult = !result || (typeof result === 'string' && result.trim().length === 0) || 
                       (Array.isArray(result) && result.length === 0);
  const isConnectionError = isError && String((result as any).message || '').includes('Transport send error');
  
  // 检测是否是有效的结果数据（通用判断）
  const hasValidData = !isError && !isEmptyResult && (
    (typeof result === 'string' && result.trim().length > 10) || // 有意义的字符串结果
    (typeof result === 'object' && result && Object.keys(result).length > 0) // 有内容的对象结果
  );
  
  let instruction = '';
  if (isConnectionError) {
    instruction = '上述调用因连接问题失败（服务器正在重连），请稍等片刻后重新调用相同工具。用户已授权，可直接重试。';
  } else if (isError) {
    instruction = '上述调用失败，请根据错误信息分析原因并重新调用或使用其他工具。';
  } else if (isEmptyResult) {
    instruction = '上述调用返回空结果，可能需要调整参数或使用其他工具获取信息。';
  } else if (hasValidData) {
    instruction = '上述调用已返回结果，请基于结果回答用户问题。';
  } else {
    instruction = '请基于上述结果回答用户问题，如信息不足可继续调用相关工具。';
  }

  // 对于 instruction-only 的 skills.run_all_skill_actions：防止模型“凭空宣布已执行/已生成文件”
  // 证据：工具仅返回 SKILL.md 指令文本，并未执行任何文件写入或脚本运行。
  let isSkillInstructionOnly = false;
  try {
    if (server === 'skills' && tool === 'run_all_skill_actions') {
      const obj = typeof result === 'string' ? JSON.parse(result) : (result as any);
      const resultsArr = obj?.results;
      const mode = obj?.mode;
      const executedActions = obj?.executedActions;
      isSkillInstructionOnly =
        mode === 'instruction' ||
        executedActions === false ||
        (Array.isArray(resultsArr) && resultsArr.length === 1 && resultsArr[0]?.actionId === 'instruction');
    }
  } catch {
    // ignore
  }

  if (isSkillInstructionOnly) {
    instruction =
      '【重要】上述 skills.run_all_skill_actions 返回的是“instruction-only 指南”，并未执行任何脚本/命令/文件写入。' +
      '你不得声称“已生成/已创建”任何文件。你只能：' +
      '1) 向用户说明当前技能缺少可执行 actions；2) 提出可执行的下一步方案（例如先 list_skill_actions 或由你生成可审批的 shell/script/file 动作计划并等待用户审批）。';
    // #region agent log
    debugLog(
      'ToolCallOrchestrator.ts:continueWithToolResult:skillInstructionOnly',
      'Instruction-only skill result guard applied',
      { assistantMessageId, server, tool },
      'H16-grounded'
    );
    // #endregion
  }

  // 二显一策略：只把摘要用于提示，不在正文回显原始JSON，以免与卡片重复
  const _followSummary = (() => {
    try {
      const obj = typeof result === 'string' ? JSON.parse(result) : result as any;
      if (obj && typeof obj === 'object') {
        const keys = Object.keys(obj).slice(0, 8);
        return `键: ${keys.join(', ')} (长度≈${JSON.stringify(obj).length})`;
      }
    } catch { /* ignore */ }
    const s = (typeof result === 'string' ? result : JSON.stringify(result ?? {})).replace(/\s+/g,' ').slice(0, 300);
    return `${s}${s.length>=300?'…':''}`;
  })();

  // 构造“包含真实结果”的追问消息（避免模型凭空猜测）
  // 多工具：把同批次所有结果合并成多个 user 消息（后续会 collapse 成一个“工具结果汇总”）
  const { toolResultToNextMessage } = await import('@/lib/mcp/providerAdapters');
  const bufNow = bufferedResultsByMessage.get(assistantMessageId);
  const processedSet = processedToolCardIdsByMessage.get(assistantMessageId) || new Set<string>();

  const orderedBatch: BufferedToolResult[] = (() => {
    try {
      const st = useChatStore.getState();
      const conv = st.conversations.find((c) => c.id === conversationId);
      const msg: any = conv?.messages.find((m) => m.id === assistantMessageId);
      const segs = Array.isArray(msg?.segments) ? msg.segments : [];
      const toolCards = segs.filter((s: any) => s?.kind === 'toolCard');
      const pendingTerminal = toolCards.filter(
        (c: any) =>
          c?.id &&
          !processedSet.has(String(c.id)) &&
          (c?.status === 'success' || c?.status === 'error')
      );
      // 关键：不要因为 toolCard 状态/渲染时序问题而“只取到部分 terminalCards”，导致漏喂工具结果。
      // 正确策略：以 bufNow 中已缓冲的结果为准（全量），仅在排序上尽量贴合 toolCards 顺序。
      const all = bufNow ? Array.from(bufNow.values()) : [];
      if (all.length === 0) return [];

      const order: BufferedToolResult[] = [];
      const used = new Set<string>();
      // 1) 优先按 pendingTerminal（成功/失败的卡片）顺序排列
      for (const c of pendingTerminal) {
        const id = String(c.id);
        const hit = bufNow?.get(id);
        if (hit) {
          order.push(hit);
          used.add(hit.cardIdOrKey);
        }
      }
      // 2) 再补齐其它已缓冲但未出现在 pendingTerminal 的结果（避免丢条）
      for (const it of all) {
        if (used.has(it.cardIdOrKey)) continue;
        order.push(it);
        used.add(it.cardIdOrKey);
      }

      // #region agent log
      debugLog(
        'ToolCallOrchestrator.ts:continueWithToolResult:batchAssemble',
        'Assembled batch for follow-up (no-drop)',
        {
          assistantMessageId,
          bufferedCount: all.length,
          terminalCardCount: pendingTerminal.length,
          orderedCount: order.length,
          dropped: all.length - order.length,
        },
        'H_MULTI'
      );
      // #endregion

      return order;
    } catch {
      return bufNow ? Array.from(bufNow.values()) : [];
    }
  })();

  const batch = orderedBatch.length > 0 ? orderedBatch : [{ cardIdOrKey: bufKey, server, tool, args, result }];

  // #region agent log
  try {
    const queries = batch.map((b: any) => {
      const q = (b?.args as any)?.query;
      return typeof q === 'string' ? q.slice(0, 80) : undefined;
    });
    debugLog(
      'ToolCallOrchestrator.ts:continueWithToolResult:batchComputed',
      'Batch computed for follow-up user messages',
      {
        assistantMessageId,
        batchLen: batch.length,
        batchKeys: batch.map((b: any) => String(b?.cardIdOrKey)).slice(0, 12),
        batchQueries: queries.filter(Boolean),
      },
      'H_MULTI'
    );
  } catch { /* noop */ }
  // #endregion

  const nextUserMsgs = batch.map((it) => {
    const msg = toolResultToNextMessage(provider as any, it.server, it.tool, it.result, originalUserContent) as any;
    msg.content = `${msg.content}\n\n—— 追加说明 ——\n${instruction}\n\n（注意：上述JSON/文本只作为事实依据，不要直接回显给用户）`;
    return msg as LlmMessage;
  });

  // #region agent log
  try {
    debugLog(
      'ToolCallOrchestrator.ts:continueWithToolResult:nextUserMsgs',
      'Built follow-up user messages from batch',
      {
        assistantMessageId,
        nextUserMsgsLen: nextUserMsgs.length,
        headSamples: nextUserMsgs.map((m: any) => String(m?.content || '').slice(0, 60)),
      },
      'H_MULTI'
    );
  } catch { /* noop */ }
  // #endregion

  // 为了确保“多工具结果不漏喂”，follow-up 统一使用“单条合并 user message”
  //（避免依赖多条 user message + collapse 的时序/构造差异导致只喂到最后一条）
  const mergedNextUserMsg = (() => {
    try {
      const pieces = batch.map((it, idx) => {
        const label = typeof (it as any)?.args?.query === 'string' ? String((it as any).args.query) : `${it.server}.${it.tool}`;
        const m = toolResultToNextMessage(provider as any, it.server, it.tool, it.result, undefined) as any;
        const extracted = extractToolResultMessage(String(m?.content || ''));
        const payload = (extracted?.payload || String(m?.content || '')).replace(/\n{4,}/g, '\n\n').slice(0, 1200);
        return `【${idx + 1}/${batch.length}】${label}\n${payload}`;
      });
      const merged = `用户原始问题：${originalUserContent}\n\n【工具结果汇总】共 ${batch.length} 次调用（仅保留必要片段）\n\n${pieces.join('\n\n---\n\n')}\n\n—— 追加说明 ——\n${instruction}\n\n（注意：上述JSON/文本只作为事实依据，不要直接回显给用户）`;
      return { role: 'user', content: merged } as any;
    } catch {
      // 兜底：至少保证有一条 user message
      return nextUserMsgs[nextUserMsgs.length - 1] as any;
    }
  })();

  const nextUserMsg = mergedNextUserMsg as any;

  // #region agent log
  try {
    const userMessages = historyForLlm.filter((m: any) => m.role === 'user');
    const contentCounts = new Map<string, number>();
    for (const msg of userMessages) {
      const content = String(msg.content || '');
      contentCounts.set(content, (contentCounts.get(content) || 0) + 1);
    }
    const duplicateUserCount = Array.from(contentCounts.values()).filter((c) => c > 1).length;
    const nextUserDupCount = contentCounts.get(String(nextUserMsg.content || '')) || 0;
    debugLog('ToolCallOrchestrator.ts:continueWithToolResult:historyStats', 'History user message stats', {
      assistantMessageId,
      userMessageCount: userMessages.length,
      duplicateUserCount,
      nextUserDupCount,
    }, 'H8');
  } catch { /* noop */ }
  // #endregion

  const _st = useChatStore.getState();
  // 继续在同一条 assistant 消息中流式续写，不新建消息

  // 使用优化后的追问提示词模块
  const { buildFollowUpSystemMessages } = await import('@/lib/prompts/FollowUpPrompts');
  const { getConnectedServers } = await import('./chatIntegration');
  
  // 获取已连接的服务器列表（用于工具上下文）
  let enabledServers: string[] = [];
  try {
    enabledServers = await getConnectedServers();
  } catch (e) {
    console.warn('[continueWithToolResult] 获取服务器列表失败:', e);
  }
  
  // 构建第一次追问的系统消息（合并为单一长消息）
  const followUpSystemMessages = await buildFollowUpSystemMessages(
    'first',
    originalUserContent,
    enabledServers,
    true, // 包含工具上下文
    isError // 是否有错误
  );

  // ========= 关键：批处理 gate（防止“工具→追问→工具”循环）=========
  // 若当前消息仍存在 running 的工具卡片，说明还在执行工具批次中：
  // 不应该在每个 TOOL_RESULT 后都触发一次 follow-up，否则模型很容易继续发起更多 web_search，形成自激振荡。
  try {
    const stGate = useChatStore.getState();
    const convGate = stGate.conversations.find(c => c.id === conversationId);
    const msgGate: any = convGate?.messages.find(m => m.id === assistantMessageId);
    const segs = Array.isArray(msgGate?.segments) ? msgGate.segments : [];
    const toolCards = segs.filter((s: any) => s?.kind === 'toolCard');
    const processed = processedToolCardIdsByMessage.get(assistantMessageId) || new Set<string>();
    const pendingCards = toolCards.filter((c: any) => c?.id && !processed.has(String(c.id)));
    const runningTools = pendingCards.filter((s: any) => s?.status === 'running' || s?.status === 'pending_auth');
    const terminalCards = pendingCards.filter((s: any) => s?.status === 'success' || s?.status === 'error');
    const bufferedCount = bufferedResultsByMessage.get(assistantMessageId)?.size || 0;

    if (runningTools.length > 0) {
      // #region agent log
      debugLog(
        'ToolCallOrchestrator.ts:continueWithToolResult:batchGate',
        'Skip follow-up because tools still running for this message',
        { assistantMessageId, runningToolCardCount: runningTools.length, pendingToolCardCount: pendingCards.length, terminalToolCardCount: terminalCards.length, bufferedCount, server, tool },
        'H_MULTI'
      );
      // #endregion
      return;
    }

    // 多工具：必须等本批次所有 pending cards 的结果都进入 buffer 后再进入 follow-up
    // 这能避免“只拿到一部分结果就追问”，从而最终只回答部分城市。
    if (pendingCards.length > 1 && bufferedCount < pendingCards.length) {
      // #region agent log
      debugLog(
        'ToolCallOrchestrator.ts:continueWithToolResult:batchGate',
        'Skip follow-up because not all tool results are buffered yet',
        { assistantMessageId, pendingToolCardCount: pendingCards.length, terminalToolCardCount: terminalCards.length, bufferedCount, server, tool },
        'H_MULTI'
      );
      // #endregion
      return;
    }
  } catch { /* noop */ }
  // ========= /批处理 gate =========

  // ========= 通用 follow-up 锁 + 递归预算（在确认进入追问后）=========
  if (!coordinator.tryAcquireFollowupLock(assistantMessageId)) {
    // #region agent log
    debugLog('ToolCallOrchestrator.ts:continueWithToolResult:debounced', 'Skipping follow-up (coordinator debounced)', {
      assistantMessageId,
      server,
      tool,
    }, 'H6');
    // #endregion
    return;
  }

  // #region agent log
  debugLog(
    'ToolCallOrchestrator.ts:continueWithToolResult:followupLockAcquired',
    'Follow-up lock acquired; will proceed',
    { assistantMessageId, server, tool },
    'H-B'
  );
  // #endregion

  const current = (globalThis as any)[counterKey] || 0;
  let maxDepth = DEFAULT_MAX_TOOL_RECURSION_DEPTH;
  try {
    const val = await StorageUtil.getItem<number | 'infinite'>('max_tool_recursion_depth', DEFAULT_MAX_TOOL_RECURSION_DEPTH, 'mcp-settings.json');
    if (val === 'infinite') maxDepth = Number.POSITIVE_INFINITY;
    else if (typeof val === 'number' && val >= 2 && val <= 15) maxDepth = val;
  } catch { /* use default */ }
  if (current >= maxDepth) {
    (globalThis as any)[counterKey] = 0;
    // #region agent log
    debugLog(
      'ToolCallOrchestrator.ts:continueWithToolResult:recursionLimit',
      'Recursion limit hit; aborting follow-up',
      { assistantMessageId, conversationId, currentDepth: current, maxDepth },
      'H-E'
    );
    // #endregion
    return;
  }
  (globalThis as any)[counterKey] = current + 1;
  // ========= /通用 follow-up 锁 + 递归预算 =========
  
  // ========= 多工具批处理：确认进入 follow-up 后再提交本批次（避免提前清 buffer）=========
  try {
    const st = useChatStore.getState();
    const conv = st.conversations.find((c) => c.id === conversationId);
    const msg: any = conv?.messages.find((m) => m.id === assistantMessageId);
    const segs = Array.isArray(msg?.segments) ? msg.segments : [];
    const toolCards = segs.filter((s: any) => s?.kind === 'toolCard');
    const processed = processedToolCardIdsByMessage.get(assistantMessageId) || new Set<string>();
    const pendingCards = toolCards.filter((c: any) => c?.id && !processed.has(String(c.id)));
    const pendingIds = pendingCards.map((c: any) => String(c.id));

    // 标记已处理
    for (const id of pendingIds) processed.add(id);
    processedToolCardIdsByMessage.set(assistantMessageId, processed);

    // 清理 buffer：只删掉已处理的 key（id 优先，否则 fallback key）
    const bufNow = bufferedResultsByMessage.get(assistantMessageId);
    if (bufNow) {
      for (const id of pendingIds) bufNow.delete(id);
      if (bufNow.size === 0) bufferedResultsByMessage.delete(assistantMessageId);
    }

    // #region agent log
    debugLog(
      'ToolCallOrchestrator.ts:continueWithToolResult:multiBatchCommit',
      'Committed multi-tool batch (post-lock)',
      { assistantMessageId, committedCount: pendingIds.length },
      'H_MULTI'
    );
    // #endregion
  } catch { /* noop */ }
  // ========= /多工具批处理 =========

  const followHistory: LlmMessage[] = [
    ...followUpSystemMessages as any,
    ...historyForLlm.filter((m:any)=>m.role!=='user' || m.content!==originalUserContent),
    nextUserMsg as any
  ];
  const compactFollowHistory = collapseToolResultUserMessages(followHistory);

  // #region agent log
  try {
    const compactUsers = (compactFollowHistory || []).filter((m: any) => m?.role === 'user');
    const lastUser = compactUsers.length ? String(compactUsers[compactUsers.length - 1]?.content || '') : '';
    debugLog(
      'ToolCallOrchestrator.ts:continueWithToolResult:compactHistory',
      'Compact follow-up history stats',
      {
        assistantMessageId,
        followHistoryLen: followHistory.length,
        compactLen: (compactFollowHistory || []).length,
        compactUserCount: compactUsers.length,
        hasMergedToolSummary: lastUser.includes('【工具结果汇总】'),
        lastUserHead: lastUser.slice(0, 80),
      },
      'H_MULTI'
    );
  } catch { /* noop */ }
  // #endregion

  // #region agent log
  try {
    const followUserMessages = followHistory.filter((m: any) => m.role === 'user');
    const counts = new Map<string, number>();
    for (const msg of followUserMessages) {
      const content = String(msg.content || '');
      counts.set(content, (counts.get(content) || 0) + 1);
    }
    const duplicateFollowUsers = Array.from(counts.values()).filter((c) => c > 1).length;
    debugLog('ToolCallOrchestrator.ts:continueWithToolResult:followHistoryStats', 'Follow-up history stats', {
      assistantMessageId,
      followUserCount: followUserMessages.length,
      duplicateFollowUsers,
    }, 'H8');
  } catch { /* noop */ }
  // #endregion

  // 追问阶段开始前再次确保状态为 loading（覆盖上游可能的 sent）
  try {
    const stPre = useChatStore.getState();
    const convPre = stPre.conversations.find(c => c.id === conversationId);
    const msgPre: any = convPre?.messages.find(m => m.id === assistantMessageId);
    // 若用户已停止（被标记为 error），直接跳过追问阶段
    if (!msgPre || msgPre.status === 'error') {
      (globalThis as any)[counterKey] = 0;
      return;
    }
    void stPre.updateMessage(assistantMessageId, { status: 'loading' });
  } catch { /* noop */ }

  // 使用统一的 StreamOrchestrator + ToolChannelParser 管线处理第一次追问
  const { StreamOrchestrator } = await import('@/lib/chat/stream');
  const { StreamResponseLogger } = await import('@/lib/chat/stream/response-logger');

  const orchestrator = new StreamOrchestrator({
    messageId: assistantMessageId,
    conversationId,
    provider,
    model,
    originalUserContent,
    historyForLlm: followHistory as any,
    onUIUpdate: () => {},
    onError: (err) => {
      // Orchestrator 内部已做基础收尾，这里只做额外保护
      try {
        const stErr = useChatStore.getState();
        void stErr.updateMessage(assistantMessageId, { status: 'error', content: err.message, error: true } as any);
      } catch { /* noop */ }
      (globalThis as any)[counterKey] = 0;
    },
  });

  const baseCallbacks = orchestrator.createCallbacks();
  const respLogger = new StreamResponseLogger(provider, model);
  let hadTextThisRound = false;
  let firstFollowupCompletedOnce = false;

  const callbacks: StreamCallbacks = {
    ...baseCallbacks,
    onStart: () => {
      baseCallbacks.onStart?.();
    },
    onEvent: (event: any) => {
      // 记录到响应日志
      if (event?.type === 'thinking_token' && event.content) {
        respLogger.appendThinking(String(event.content));
      } else if (event?.type === 'thinking_end') {
        respLogger.endThinking();
      } else if (event?.type === 'content_token' && event.content) {
        const txt = String(event.content);
        respLogger.appendContent(txt);
        // 关键：只在“严格过滤掉工具指令/模板残片后”的可见文本存在时，才认为本轮产生了有效正文
        // 原因：GPT-OSS 经常输出半截 "<|ch" / "<|channel|>" 等残片；
        // 若仅用 filterToolCallContent，会误判为“有正文”，从而跳过 second follow-up，导致“工具跑完但没后续回答”。
        const visible = filterForDisplay(filterToolCallContent(txt));
        const trimmed = visible.trim();
        const isOnlyOssTagFragment = trimmed.startsWith('<|') || /^<\|\w{0,20}$/i.test(trimmed);
        if (trimmed.length > 0 && !isOnlyOssTagFragment) {
          hadTextThisRound = true;
        }
      }
      baseCallbacks.onEvent?.(event);
    },
    onToken: baseCallbacks.onToken,
    onComplete: async () => {
      if (firstFollowupCompletedOnce) {
        // #region agent log
        debugLog(
          'ToolCallOrchestrator.ts:continueWithToolResult:firstFollowup:onComplete:dup',
          'First follow-up onComplete suppressed (duplicate)',
          { assistantMessageId },
          'H-D'
        );
        // #endregion
        return;
      }
      firstFollowupCompletedOnce = true;
      const st = useChatStore.getState();
      try {
        // 先让 Orchestrator 做完正式收尾（包括 STREAM_END 与内容清理）
        await baseCallbacks.onComplete?.();
      } finally {
        // 基于“最终落库内容”再算一遍是否有正文（避免 token 过程被 commentary 残片误判）
        try {
          const st2 = useChatStore.getState();
          const conv2 = st2.conversations.find((c) => c.id === conversationId);
          const msg2: any = conv2?.messages.find((m: any) => m.id === assistantMessageId);
          const finalText = String(msg2?.content || '');
          const visibleFinal = filterToolInstructions(finalText, { mode: 'display' }).trim();
          if (visibleFinal.length === 0) {
            hadTextThisRound = false;
          }
        } catch { /* noop */ }

        // #region agent log
        debugLog(
          'ToolCallOrchestrator.ts:continueWithToolResult:firstFollowup:onComplete',
          'First follow-up onComplete fired',
          { assistantMessageId, hadTextThisRound },
          'H-D'
        );
        // #endregion
        try {
          respLogger.logComplete(assistantMessageId);
        } catch (e) {
          console.error('[continueWithToolResult] First follow-up respLogger.logComplete error:', e);
        }

        // 调试：输出本轮追问的整体情况
        try {
          const conv = st.conversations.find((c) => c.id === conversationId);
          const msg: any = conv?.messages.find((m: any) => m.id === assistantMessageId);
          const finalContent = msg?.content || '';
          const segments = Array.isArray(msg?.segments) ? msg.segments : [];
          const textSegments = segments.filter((s: any) => s.kind === 'text');
          console.debug('[FollowUp/First] stream complete', {
            messageId: assistantMessageId,
            hadTextThisRound,
            contentLength: finalContent.length,
            segmentsCount: segments.length,
            textSegmentsCount: textSegments.length,
            contentPreview: finalContent.substring(0, 50),
          });
        } catch { /* noop */ }

        // 若本轮没有任何正文输出，则进入第二次“催促式”追问
        if (!hadTextThisRound) {
          await runSecondFollowUpRound({
            assistantMessageId,
            provider,
            model,
            conversationId,
            originalUserContent,
            followHistory,
            result,
            server,
            counterKey,
          });
        } else {
          await finishRecursionAndMaybeGenerateTitle({
            provider,
            model,
            conversationId,
            counterKey,
          });
        }
      }
    },
    onError: (err: Error) => {
      // #region agent log
      debugLog(
        'ToolCallOrchestrator.ts:continueWithToolResult:firstFollowup:onError',
        'First follow-up onError fired',
        { assistantMessageId, message: err?.message },
        'H-C'
      );
      // #endregion
      baseCallbacks.onError?.(err);
      try {
        const stErr = useChatStore.getState();
        void stErr.updateMessage(assistantMessageId, { status: 'error', content: err.message, error: true } as any);
      } catch { /* noop */ }
      (globalThis as any)[counterKey] = 0;
    },
  } as any;

  // #region agent log
  debugLog(
    'ToolCallOrchestrator.ts:continueWithToolResult:streamChat:start',
    'Starting follow-up streamChat',
    {
      assistantMessageId,
      provider,
      model,
      followHistoryLen: Array.isArray(followHistory) ? followHistory.length : undefined,
      originalUserContentLen: String(originalUserContent || '').length,
      toolContext: `${server}.${tool}`,
    },
    'H-C'
  );
  // #endregion

  // Native-only + Event-only：追问轮也必须携带 tools（skills + mcp + web_search），否则模型无法继续调用工具。
  // 复用与主聊天一致的 composeChatOptions（内部会强制 nativeTools，并附带 mcpServers）。
  const { composeChatOptions } = await import('@/lib/chat/OptionComposer');
  const followupOpts = await composeChatOptions(
    provider,
    model,
    {},
    conversationId || null,
    String(nextUserMsg.content || '')
  );
  await streamChat(provider, model, compactFollowHistory as any, callbacks, followupOpts);
}

/**
 * 第二次“催促式”追问：当第一次追问没有任何正文输出时触发。
 * 仍然复用统一的 StreamOrchestrator + ToolChannelParser 管线。
 */
async function runSecondFollowUpRound(args: {
  assistantMessageId: string;
  provider: string;
  model: string;
  conversationId: string;
  originalUserContent: string;
  followHistory: LlmMessage[];
  result: unknown;
  server: string;
  counterKey: string;
}) {
  const {
    assistantMessageId,
    provider,
    model,
    conversationId,
    originalUserContent,
    followHistory,
    result,
    server,
    counterKey,
  } = args;

  const { buildFollowUpSystemMessages } = await import('@/lib/prompts/FollowUpPrompts');

  // #region agent log
  debugLog(
    'ToolCallOrchestrator.ts:runSecondFollowUpRound:entry',
    'Second follow-up round entered',
    { assistantMessageId, conversationId, provider, model, server },
    'H-S2'
  );
  // #endregion

  // 第二次追问只保留用户消息，过滤掉第一次追问的所有 system 消息
  let secondFollowUpMessages: Array<{ role: 'system'; content: string }> = [];
  try {
    secondFollowUpMessages = await buildFollowUpSystemMessages(
      'second',
      originalUserContent,
      [], // 第二次追问不提供工具上下文
      false // 不包含工具上下文
    );
  } catch {
    // 兜底：避免第二轮因 system prompt 构建失败而“直接断流”
    try {
      const { buildFollowUpSystemMessagesSync } = await import('@/lib/prompts/FollowUpPrompts');
      secondFollowUpMessages = buildFollowUpSystemMessagesSync('second', originalUserContent, [], false);
    } catch { /* noop */ }
  }

  // #region agent log
  debugLog(
    'ToolCallOrchestrator.ts:runSecondFollowUpRound:systemMessagesReady',
    'Second follow-up system messages ready',
    { assistantMessageId, count: secondFollowUpMessages.length },
    'H-S2'
  );
  // #endregion

  const nudgeHistory: LlmMessage[] = [
    ...secondFollowUpMessages as any,
    // 只保留 followHistory 中的 user 消息（工具结果）
    ...followHistory.filter((m: any) => m.role === 'user'),
    {
      role: 'user',
      content: `请基于上述所有工具调用结果，分析并回答用户的原始问题。

请根据实际情况灵活处理：
1. 如果工具结果正常且足够，请直接给出完整的中文答案
2. 如果工具结果异常或不足，请继续调用相关工具
3. 如果需要调用工具，请使用 <use_mcp_tool><server_name>...</server_name><tool_name>...</tool_name><arguments>{...}</arguments></use_mcp_tool> 格式
4. 确保最终能够完整回答用户的原始问题`,
    } as any,
  ];
  const compactNudgeHistory = collapseToolResultUserMessages(nudgeHistory);

  const { StreamOrchestrator } = await import('@/lib/chat/stream');
  const { StreamResponseLogger } = await import('@/lib/chat/stream/response-logger');

  const stPre = useChatStore.getState();
  try {
    void stPre.updateMessage(assistantMessageId, { status: 'loading' });
  } catch { /* noop */ }

  const orchestrator = new StreamOrchestrator({
    messageId: assistantMessageId,
    conversationId,
    provider,
    model,
    originalUserContent,
    historyForLlm: nudgeHistory as any,
    onUIUpdate: () => {},
    onError: (err) => {
      try {
        const stErr = useChatStore.getState();
        void stErr.updateMessage(assistantMessageId, { status: 'error', content: err.message, error: true } as any);
      } catch { /* noop */ }
      (globalThis as any)[counterKey] = 0;
    },
  });

  const baseCallbacks = orchestrator.createCallbacks();
  const respLogger2 = new StreamResponseLogger(provider, model);
  let hadTextSecondRound = false;
  let secondFollowupCompletedOnce = false;

  const callbacks2: StreamCallbacks = {
    ...baseCallbacks,
    onStart: () => {
      baseCallbacks.onStart?.();
    },
    onEvent: (event: any) => {
      if (event?.type === 'thinking_token' && event.content) {
        respLogger2.appendThinking(String(event.content));
      } else if (event?.type === 'thinking_end') {
        respLogger2.endThinking();
      } else if (event?.type === 'content_token' && event.content) {
        const txt = String(event.content);
        respLogger2.appendContent(txt);
        // 同样基于过滤后的“可见文本”判断是否有正文输出
        const visible = filterForDisplay(filterToolCallContent(txt));
        const trimmed = visible.trim();
        const isOnlyOssTagFragment = trimmed.startsWith('<|') || /^<\|\w{0,20}$/i.test(trimmed);
        if (trimmed.length > 0 && !isOnlyOssTagFragment) {
          hadTextSecondRound = true;
        }
      }
      baseCallbacks.onEvent?.(event);
    },
    onToken: baseCallbacks.onToken,
    onComplete: async () => {
      if (secondFollowupCompletedOnce) {
        // #region agent log
        debugLog(
          'ToolCallOrchestrator.ts:runSecondFollowUpRound:onComplete:dup',
          'Second follow-up onComplete suppressed (duplicate)',
          { assistantMessageId },
          'H-S2'
        );
        // #endregion
        return;
      }
      secondFollowupCompletedOnce = true;
      const st = useChatStore.getState();
      try {
        await baseCallbacks.onComplete?.();
      } finally {
        // #region agent log
        debugLog(
          'ToolCallOrchestrator.ts:runSecondFollowUpRound:onComplete',
          'Second follow-up onComplete fired',
          { assistantMessageId, hadTextSecondRound },
          'H-S2'
        );
        // #endregion
        try {
          respLogger2.logComplete(assistantMessageId);
        } catch (e) {
          console.error('[continueWithToolResult] Second follow-up respLogger.logComplete error:', e);
        }

        const conv = st.conversations.find((c) => c.id === conversationId);
        const msg: any = conv?.messages.find((m: any) => m.id === assistantMessageId);
        let content2 = msg?.content || '';
        const segments2 = Array.isArray(msg?.segments) ? msg.segments : [];
        const textSegments2 = segments2.filter((s: any) => s.kind === 'text');

        try {
          console.debug('[FollowUp/Second] stream complete', {
            messageId: assistantMessageId,
            hadTextSecondRound,
            contentLength: content2.length,
            segmentsCount: segments2.length,
            textSegmentsCount: textSegments2.length,
            contentPreview: content2.substring(0, 50),
          });
        } catch { /* noop */ }

        // 若追问仍无任何正文，则使用结果生成一个最小可读的回退文本，避免界面空白
        if (!hadTextSecondRound) {
          try {
            if (server === WEB_SEARCH_SERVER_NAME && Array.isArray(result) && result.length > 0) {
              const items: any[] = Array.isArray(result) ? result.slice(0, 5) : [];
              const lines = items.map((it, i: number) => {
                const t = (it?.source_title || it?.title || '').toString().trim();
                const u = (it?.url || '').toString().trim();
                return `${i + 1}. ${t}${u ? ` - ${u}` : ''}`;
              });
              const fallbackText = `根据网络搜索的结果，供参考：\n${lines.join('\n')}\n\n需要我基于这些链接进一步总结或继续检索吗？`;
              try {
                st.appendTextToMessageSegments(assistantMessageId, fallbackText);
              } catch { /* noop */ }
              content2 = ((msg?.content || '') + fallbackText).trim();
            }
          } catch { /* noop */ }
        }

        try {
          void st.updateMessage(assistantMessageId, { status: 'sent', content: content2 });
          st.dispatchMessageAction(assistantMessageId, { type: 'STREAM_END' } as any);
        } catch { /* noop */ }

        await finishRecursionAndMaybeGenerateTitle({
          provider,
          model,
          conversationId,
          counterKey,
        });
      }
    },
    onError: (err: Error) => {
      baseCallbacks.onError?.(err);
      try {
        const stErr = useChatStore.getState();
        void stErr.updateMessage(assistantMessageId, { status: 'error', content: err.message, error: true } as any);
      } catch { /* noop */ }
      (globalThis as any)[counterKey] = 0;
    },
  } as any;

  // #region agent log
  debugLog(
    'ToolCallOrchestrator.ts:runSecondFollowUpRound:streamChat:start',
    'Starting second follow-up streamChat',
    { assistantMessageId, nudgeHistoryLen: nudgeHistory.length },
    'H-S2'
  );
  // #endregion

  const { composeChatOptions } = await import('@/lib/chat/OptionComposer');
  const nudgeOpts = await composeChatOptions(
    provider,
    model,
    {},
    conversationId || null,
    String(compactNudgeHistory?.[compactNudgeHistory.length - 1]?.content || '')
  );
  await streamChat(provider, model, compactNudgeHistory as any, callbacks2, nudgeOpts);
}

/**
 * 递归链结束时的统一收尾：重置递归计数，并在合适时机生成会话标题。
 */
async function finishRecursionAndMaybeGenerateTitle(args: {
  provider: string;
  model: string;
  conversationId: string;
  counterKey: string;
}) {
  const { provider, model, conversationId, counterKey } = args;
  (globalThis as any)[counterKey] = 0;

  try {
    const state = useChatStore.getState();
    const conv = state.conversations.find((c) => c.id === conversationId);
    if (!conv) return;

    const {
      shouldGenerateTitleAfterAssistantComplete,
      extractFirstUserMessageSeed,
      isDefaultTitle,
    } = await import('@/lib/chat/TitleGenerator');
    const { generateTitle } = await import('@/lib/chat/TitleService');

    if (!shouldGenerateTitleAfterAssistantComplete(conv)) return;
    const seed = extractFirstUserMessageSeed(conv);
    if (!seed || !seed.trim()) return;

    const gen = await generateTitle(provider, model, seed, { maxLength: 24, language: 'zh' });
    const st2 = useChatStore.getState();
    const conv2 = st2.conversations.find((c) => c.id === conversationId);
    if (conv2 && isDefaultTitle(conv2.title) && gen && gen.trim()) {
      void st2.renameConversation(String(conversationId), gen.trim());
    }
  } catch {
    // 忽略标题生成中的非致命错误
  }
}

