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
  cardId?: string;
  lockKey?: string;
}): Promise<void> {
  const { assistantMessageId, conversationId, server, tool, args, provider, model, historyForLlm, originalUserContent, cardId, lockKey } = params;
  
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
            await continueWithToolResult({ assistantMessageId, provider, model, conversationId, historyForLlm, originalUserContent, server, tool: effectiveTool, result: recent });
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

export async function continueWithToolResult(params: {
  assistantMessageId: string;
  provider: string;
  model: string;
  conversationId: string;
  historyForLlm: LlmMessage[];
  originalUserContent: string;
  server: string;
  tool: string;
  result: unknown;
}) {
  const { assistantMessageId, provider, model, conversationId, historyForLlm, originalUserContent, server, tool, result } = params;
  
  // Fallback 去重：同一消息在短时间内只允许一个 follow-up 流程
  if (!coordinator.tryAcquireFollowupLock(assistantMessageId)) {
    // #region agent log
    debugLog('ToolCallOrchestrator.ts:continueWithToolResult:debounced', 'Skipping fallback (coordinator debounced)', { 
      assistantMessageId, 
      server,
      tool 
    }, 'H6');
    // #endregion
    console.log(`[MCP-DEBUG] 跳过重复 fallback: ${assistantMessageId}`);
    return;
  }
  
  const key = conversationId;
  const counterKey = `mcp-recursion-${key}`;
  // 简易递归限制（避免依赖外部模块）
  const current = (globalThis as any)[counterKey] || 0;
  // 读取设置中的递归深度（mcp-settings.json）
  let maxDepth = DEFAULT_MAX_TOOL_RECURSION_DEPTH;
  try {
    const val = await StorageUtil.getItem<number|'infinite'>('max_tool_recursion_depth', DEFAULT_MAX_TOOL_RECURSION_DEPTH, 'mcp-settings.json');
    if (val === 'infinite') maxDepth = Number.POSITIVE_INFINITY;
    else if (typeof val === 'number' && val >= 2 && val <= 15) maxDepth = val;
  } catch { /* use default */ }
  if (current >= maxDepth) {
    (globalThis as any)[counterKey] = 0;
    // 显示右下角通知
    try {
      const { toast } = await import('@/components/ui/sonner');
      toast.warning('MCP递归调用已达上限', {
        description: `已达到最大递归深度 ${maxDepth}，停止继续调用工具。您可以在MCP高级设置中调整此限制。`,
        duration: 6000,
      });
    } catch (err) {
      console.warn('[MCP] 显示递归限制通知失败:', err);
    }
    return;
  }
  (globalThis as any)[counterKey] = current + 1;

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
  const { toolResultToNextMessage } = await import('@/lib/mcp/providerAdapters');
  const nextUserMsg = toolResultToNextMessage(provider as any, server, tool, result, originalUserContent);
  // 将工程化的补充说明拼接到消息末尾，保留真实结果文本
  nextUserMsg.content = `${nextUserMsg.content}\n\n—— 追加说明 ——\n${instruction}\n\n（注意：上述JSON/文本只作为事实依据，不要直接回显给用户）`;

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

  const followHistory: LlmMessage[] = [
    ...followUpSystemMessages as any,
    ...historyForLlm.filter((m:any)=>m.role!=='user' || m.content!==originalUserContent),
    nextUserMsg as any
  ];

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
        // 关键：只在“过滤掉工具指令后的可见文本”存在时，才认为本轮产生了有效正文
        const visible = filterToolCallContent(txt);
        if (visible.trim().length > 0) {
          hadTextThisRound = true;
        }
      }
      baseCallbacks.onEvent?.(event);
    },
    onToken: baseCallbacks.onToken,
    onComplete: async () => {
      const st = useChatStore.getState();
      try {
        // 先让 Orchestrator 做完正式收尾（包括 STREAM_END 与内容清理）
        await baseCallbacks.onComplete?.();
      } finally {
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
      baseCallbacks.onError?.(err);
      try {
        const stErr = useChatStore.getState();
        void stErr.updateMessage(assistantMessageId, { status: 'error', content: err.message, error: true } as any);
      } catch { /* noop */ }
      (globalThis as any)[counterKey] = 0;
    },
  } as any;

  await streamChat(provider, model, followHistory as any, callbacks, {});
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

  // 第二次追问只保留用户消息，过滤掉第一次追问的所有 system 消息
  const secondFollowUpMessages = buildFollowUpSystemMessages(
    'second',
    originalUserContent,
    [], // 第二次追问不提供工具上下文
    false, // 不包含工具上下文
  );

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
        const visible = filterToolCallContent(txt);
        if (visible.trim().length > 0) {
          hadTextSecondRound = true;
        }
      }
      baseCallbacks.onEvent?.(event);
    },
    onToken: baseCallbacks.onToken,
    onComplete: async () => {
      const st = useChatStore.getState();
      try {
        await baseCallbacks.onComplete?.();
      } finally {
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

  await streamChat(provider, model, nudgeHistory as any, callbacks2, {});
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

