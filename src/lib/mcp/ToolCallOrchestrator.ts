// 仅保留必要调试输出，不禁用全局 no-console
import { useChatStore } from '@/store/chatStore';
import { streamChat } from '@/lib/llm';
import { StreamOrchestrator } from '@/lib/chat/stream/StreamOrchestrator';
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

  // ========= /多工具批处理 =========

  // ========= 关键：稳健 gate（expectedCount vs bufferedCount）=========
  // 避免“第一条 TOOL_RESULT 抢 follow-up 锁并提前发起追问”，导致只喂到 1 条结果。
  try {
    const expected = expectedToolCardIdsByMessage.get(assistantMessageId);
    const expectedCount = expected ? expected.size : 0;
    const bufferedCount = buf.size;
    const shouldGate = expectedCount > 1;
    const shouldProceed = !shouldGate || bufferedCount >= expectedCount;

  
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
    // 特殊处理：list_available_skills 工具返回后，添加明确引导
    if (server === 'skills' && tool === 'list_available_skills') {
      instruction = '已获取技能列表。下一步：调用 skills.get_skill_instructions({skillId: "技能ID"}) 获取使用指南（从列表中选择合适的技能ID）。';
        } else {
      instruction = '上述调用已返回结果，请基于结果回答用户问题。';
    }
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
      '[IMPORTANT] instruction-only skill returned guidance only (no execution). Do NOT claim file created. ' +
      'New Strategy: Call filesystem.read_file / filesystem.write_file / shell_executor.execute_command step by step. ' +
      'Example: read_file -> write_file -> execute_command. FORBIDDEN: submit_execution_plan or run_skill_action';
    }

  // ========= 修复：真正触发follow-up LLM调用 =========
  // 问题：之前只计算了instruction，但从未使用
  // 修复：将工具结果和instruction传递给LLM，触发follow-up
  
  // 构建工具结果消息
  const toolResultContent = `【工具调用结果】
工具: ${server}.${tool}
结果:
${JSON.stringify(result, null, 2)}

${instruction}`;

  // 获取最新的对话历史
  const store = useChatStore.getState();
  const conversation = store.conversations.find(c => c.id === conversationId);
  const currentHistory = conversation?.messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content || ''
    })) || [];

  // 添加工具结果作为新的user消息
  const followUpMessages: LlmMessage[] = [
    ...currentHistory,
    {
      role: 'user',
      content: toolResultContent
    }
  ];


  // 调用LLM API（follow-up）
  try {

    
    // 使用StreamOrchestrator处理完整的事件流（包括tool_call等）
    const orchestrator = new StreamOrchestrator({
      messageId: assistantMessageId,
      conversationId,
      provider,
      model,
      originalUserContent: toolResultContent,
      historyForLlm: followUpMessages,
      onUIUpdate: (_updatedContent) => {
        // Follow-up场景不需要UI更新
      },
      onError: (error) => {

        console.error('[continueWithToolResult] Follow-up failed:', error);
        store.updateMessage(assistantMessageId, { status: 'error' });
      },
    });
    
    const streamCallbacks = orchestrator.createCallbacks();

    
    await streamChat(
      provider,
      model,
      followUpMessages,
      streamCallbacks,
      { conversationId, messageId: assistantMessageId }
    );

  } catch (error) {

    console.error('[continueWithToolResult] Failed to trigger follow-up:', error);
    // 即使follow-up失败，也不抛出错误，避免影响工具执行流程
  }
  // ========= /修复 =========
}
