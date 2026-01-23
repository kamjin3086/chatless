/**
 * MCP工具执行器
 * 
 * 负责处理MCP服务器工具调用的所有逻辑，包括：
 * - 工具存在性校验
 * - 授权检查和用户授权流程
 * - 缓存检查和结果复用
 * - 服务器连接确保
 * - 工具调用执行
 * - 分阶段Schema提示构建
 * - 错误处理和日志记录
 */

import { useChatStore } from '@/store/chatStore';
import { useAuthorizationStore } from '@/store/authorizationStore';
import { serverManager } from '../ServerManager';
import { persistentCache } from '../persistentCache';
import { mcpCallHistory } from '../callHistory';
import { shouldAutoAuthorize } from '../authorizationConfig';
import { buildSchemaHint, buildDetailedToolGuide } from '../schemaHints';
import { incrementFailCount, buildConciseGuideText } from '../utils/FailureTracker';
import { ensureServerConnected } from './ConnectionManager';
import type { ToolCallParams } from './types';

// #region agent log
const DEBUG_LOG_ENDPOINT = 'http://127.0.0.1:7244/ingest/9f8e7fe1-428e-4909-b4e4-b7238838d737';
function debugLog(location: string, message: string, data?: unknown, hypothesisId?: string) {
  fetch(DEBUG_LOG_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location, message, data, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId }) }).catch(() => {});
}
// #endregion

const DEBUG_MCP = false;

/**
 * MCP工具执行器类
 */
export class McpToolExecutor {
  private params: ToolCallParams;
  private callKey: string;
  private effectiveTool: string;
  private effectiveArgs: Record<string, unknown>;

  constructor(params: ToolCallParams, callKey: string) {
    this.params = params;
    this.callKey = callKey;
    this.effectiveTool = params.tool;
    this.effectiveArgs = params.args || {};
  }

  /**
   * 执行MCP工具调用
   */
  async execute(): Promise<void> {
    const { server } = this.params;

    // #region agent log
    debugLog('McpToolExecutor.ts:execute:entry', 'MCP tool execution started', { server, tool: this.effectiveTool, args: this.effectiveArgs }, 'H1');
    // #endregion

    try {
      // 降噪：仅输出一条简要日志
      console.debug(`[MCP] 调用 ${server}.${this.effectiveTool}`);

      // 1. 工具存在性校验
      const toolExists = await this.validateToolExists();
      if (!toolExists) return;

      // 2. 授权检查
      const authorized = await this.checkAuthorization();
      if (!authorized) return;

      // 3. 缓存检查
      const cachedResult = await this.checkCache();
      if (cachedResult !== null) return;

      // 4. 确保服务器连接
      await this.ensureConnection();

      // 5. 执行工具调用
      const result = await this.executeTool();

      // 6. 处理成功结果
      await this.handleSuccess(result);
    } catch (e) {
      // 7. 错误处理
      await this.handleError(e);
    }
  }

  /**
   * 验证工具是否存在
   */
  private async validateToolExists(): Promise<boolean> {
    const { assistantMessageId, server, cardId } = this.params;

    try {
      // 优先使用持久化缓存获取工具列表
      let available = await persistentCache.getToolsWithCache(server);
      if (!Array.isArray(available) || available.length === 0) {
        // 缓存失败，使用原有方法
        const { getToolsCached } = await import('../toolsCache');
        available = await getToolsCached(server);
      }

      if (available && Array.isArray(available)) {
        const ok = available.some(
          (t: any) => (t?.name || '').toLowerCase() === String(this.effectiveTool).toLowerCase()
        );

        if (!ok) {
          // 工具不存在，构建错误提示
          const toolList = (available || [])
            .filter((t: any) => t?.name)
            .map((t: any) => {
              const nm = String(t.name);
              const desc = t?.description ? String(t.description) : '';
              return desc ? `${nm} - ${desc}` : nm;
            });

          const hint = `错误：服务器"${server}"中找不到工具"${this.effectiveTool}"。\n\n该服务器的可用工具如下：\n${toolList.map(tool => `• ${tool}`).join('\n')}`;
          console.warn(`[MCP] 工具不存在: ${server}.${this.effectiveTool}`);

          const st = useChatStore.getState();
          const fixHint = `解决方案：请从以下可用工具中选择一个：\n${toolList.map(tool => `• ${tool}`).join('\n')}\n\n然后重新调用：<use_mcp_tool><server_name>${server}</server_name><tool_name>正确的工具名</tool_name><arguments>{}</arguments></use_mcp_tool>`;

          st.dispatchMessageAction(assistantMessageId, {
            type: 'TOOL_RESULT',
            server,
            tool: this.effectiveTool,
            ok: false,
            errorMessage: hint,
            schemaHint: fixHint,
            cardId,
          });

          // 继续追问流程，让AI自我纠正
          const ToolCallOrchestrator = await import('../ToolCallOrchestrator');
          const continueWithToolResult = ToolCallOrchestrator.continueWithToolResult;
          await continueWithToolResult({
            assistantMessageId,
            provider: this.params.provider,
            model: this.params.model,
            conversationId: this.params.conversationId,
            historyForLlm: this.params.historyForLlm,
            originalUserContent: this.params.originalUserContent,
            server,
            tool: this.effectiveTool,
            args: this.effectiveArgs || {},
            result: {
              error: 'TOOL_NOT_FOUND',
              message: hint,
              availableTools: available?.map((t: any) => t?.name).filter(Boolean) || [],
              availableToolsWithDescriptions: toolList,
            },
          });

          return false;
        }
      }
    } catch (e) {
      // 忽略工具列表获取失败，继续执行
      console.warn(`[MCP] 获取工具列表失败: ${server}`, e);
    }

    return true;
  }

  /**
   * 检查授权
   */
  private async checkAuthorization(): Promise<boolean> {
    const { assistantMessageId, server, cardId } = this.params;

    // 检查是否自动授权
    const autoAuth = await shouldAutoAuthorize(server);
    console.debug(`[MCP-AUTH] 授权检查: ${server}.${this.effectiveTool}, auto=${autoAuth}`);

    // #region agent log
    debugLog('McpToolExecutor.ts:checkAuth', 'Authorization check', { server, tool: this.effectiveTool, autoAuth }, 'H5');
    // #endregion

    if (autoAuth) {
      return true;
    }

    // 需要用户授权
    const effectiveCardId = cardId || crypto.randomUUID();
    console.debug(`[MCP-AUTH] 等待用户授权: ${server}.${this.effectiveTool}`);

    const st = useChatStore.getState();

    // 如果卡片已经在tool_call事件时设置为pending_auth，这里就不需要再次更新
    if (!cardId) {
      st.dispatchMessageAction(assistantMessageId, {
        type: 'TOOL_RESULT',
        server,
        tool: this.effectiveTool,
        ok: false,
        errorMessage: 'pending_auth',
        cardId: effectiveCardId,
      });
    }

    // 等待用户授权
    const authorized = await new Promise<boolean>((resolve) => {
      const authStore = useAuthorizationStore.getState();
      authStore.addPendingAuthorization({
        id: effectiveCardId,
        messageId: assistantMessageId,
        server,
        tool: this.effectiveTool,
        args: this.effectiveArgs || {},
        createdAt: Date.now(),
        onApprove: () => resolve(true),
        onReject: () => resolve(false),
      });
    });

    console.debug(`[MCP-AUTH] 授权结果: ${server}.${this.effectiveTool}, ok=${authorized}`);

    if (!authorized) {
      // 用户拒绝授权
      console.warn(`[MCP-AUTH] 用户拒绝: ${server}.${this.effectiveTool}`);
      st.dispatchMessageAction(assistantMessageId, {
        type: 'TOOL_RESULT',
        server,
        tool: this.effectiveTool,
        ok: false,
        errorMessage: '用户拒绝授权此工具调用',
        cardId: effectiveCardId,
      });

      // 继续追问流程，让AI知道用户拒绝了
      const ToolCallOrchestrator = await import('../ToolCallOrchestrator');
      const continueWithToolResult = ToolCallOrchestrator.continueWithToolResult;
      await continueWithToolResult({
        assistantMessageId,
        provider: this.params.provider,
        model: this.params.model,
        conversationId: this.params.conversationId,
        historyForLlm: this.params.historyForLlm,
        originalUserContent: this.params.originalUserContent,
        server,
        tool: this.effectiveTool,
        args: this.effectiveArgs || {},
        result: {
          error: 'AUTHORIZATION_DENIED',
          message: '用户拒绝了此工具调用。这可能是因为用户认为此调用不合理或参数有误。请考虑用户的反馈，调整你的方法或询问用户的具体需求。',
        },
      });

      return false;
    }

    // 用户批准
    console.debug(`[MCP-AUTH] 已批准，继续: ${server}.${this.effectiveTool}`);
    return true;
  }

  /**
   * 检查缓存
   */
  private async checkCache(): Promise<unknown | null> {
    const { assistantMessageId, server, cardId } = this.params;

    // 授权通过后：若短时间内相同请求已成功，直接复用结果并继续追问链路
    if (mcpCallHistory.isDuplicateCall(server, this.effectiveTool, this.effectiveArgs)) {
      const recent = mcpCallHistory.getRecentResult(server, this.effectiveTool, this.effectiveArgs);
      if (recent) {
        const st = useChatStore.getState();
        const resultPreview =
          typeof recent === 'string' ? recent.slice(0, 12000) : JSON.stringify(recent).slice(0, 12000);

        st.dispatchMessageAction(assistantMessageId, {
          type: 'TOOL_RESULT',
          server,
          tool: this.effectiveTool,
          ok: true,
          resultPreview,
          cardId,
        });

        const ToolCallOrchestrator = await import('../ToolCallOrchestrator');
        const continueWithToolResult = ToolCallOrchestrator.continueWithToolResult;
        await continueWithToolResult({
          assistantMessageId,
          provider: this.params.provider,
          model: this.params.model,
          conversationId: this.params.conversationId,
          historyForLlm: this.params.historyForLlm,
          originalUserContent: this.params.originalUserContent,
          server,
          tool: this.params.tool,
          args: this.effectiveArgs || {},
          result: recent,
        });

        return recent;
      }
    }

    return null;
  }

  /**
   * 确保服务器连接
   */
  private async ensureConnection(): Promise<void> {
    const { server } = this.params;
    await ensureServerConnected(server);
  }

  /**
   * 执行工具调用
   */
  private async executeTool(): Promise<unknown> {
    const { server } = this.params;

    const result = await serverManager.callTool(server, this.effectiveTool, this.effectiveArgs || undefined);
    console.debug(`[MCP] 成功: ${server}.${this.effectiveTool}`);

    return result;
  }

  /**
   * 处理成功结果
   */
  private async handleSuccess(result: unknown): Promise<void> {
    const { assistantMessageId, server, cardId } = this.params;

    // 记录成功调用
    mcpCallHistory.recordCall(server, this.effectiveTool, this.effectiveArgs, true, result);

    if (DEBUG_MCP) {
      try {
        console.log('[MCP-ORCH] ok', server, this.effectiveTool);
      } catch {
        /* noop */
      }
    }

    const resultPreview =
      typeof result === 'string' ? result.slice(0, 12000) : JSON.stringify(result).slice(0, 12000);

    const st = useChatStore.getState();
    st.dispatchMessageAction(assistantMessageId, {
      type: 'TOOL_RESULT',
      server,
      tool: this.effectiveTool,
      ok: true,
      resultPreview,
      cardId,
    });

    const ToolCallOrchestrator = await import('../ToolCallOrchestrator');
    const continueWithToolResult = ToolCallOrchestrator.continueWithToolResult;
    await continueWithToolResult({
      assistantMessageId,
      provider: this.params.provider,
      model: this.params.model,
      conversationId: this.params.conversationId,
      historyForLlm: this.params.historyForLlm,
      originalUserContent: this.params.originalUserContent,
      server,
      tool: this.params.tool,
      args: this.effectiveArgs || {},
      result,
    });
  }

  /**
   * 处理错误
   */
  private async handleError(e: unknown): Promise<void> {
    const { assistantMessageId, server, conversationId, cardId } = this.params;
    const err = e instanceof Error ? e.message : String(e);

    console.error(`[MCP] 工具调用失败: ${server}.${this.effectiveTool}`, {
      server,
      tool: this.effectiveTool,
      args: this.effectiveArgs,
      error: err,
      errorType: typeof e,
      errorStack: e instanceof Error ? e.stack : undefined,
      timestamp: new Date().toISOString(),
    });

    // 记录失败调用
    mcpCallHistory.recordCall(server, this.effectiveTool, this.effectiveArgs, false);

    if (DEBUG_MCP) {
      try {
        console.warn('[MCP-ORCH] err', server, this.effectiveTool);
      } catch {
        /* noop */
      }
    }

    // 构建分阶段提示
    const failStage = incrementFailCount(conversationId, server, this.effectiveTool);
    const combinedHint = await this.buildSchemaHints(err, failStage);

    console.warn(`[MCP] 工具调用错误: ${server}.${this.effectiveTool} -> ${err}`);

    const st = useChatStore.getState();
    st.dispatchMessageAction(assistantMessageId, {
      type: 'TOOL_RESULT',
      server,
      tool: this.effectiveTool,
      ok: false,
      errorMessage: err,
      schemaHint: combinedHint,
      cardId,
    });

    // 继续追问链路，把错误与schema提示一并提供给模型
    try {
      const ToolCallOrchestrator = await import('../ToolCallOrchestrator');
      const continueWithToolResult = ToolCallOrchestrator.continueWithToolResult;
      await continueWithToolResult({
        assistantMessageId,
        provider: this.params.provider,
        model: this.params.model,
        conversationId,
        historyForLlm: this.params.historyForLlm,
        originalUserContent: this.params.originalUserContent,
        server,
        tool: this.effectiveTool,
        args: this.effectiveArgs || {},
        result: {
          error: 'CALL_TOOL_FAILED',
          message: err,
          schemaHint: combinedHint,
          failStage,
        },
      });
    } catch (continueErr) {
      console.error('[MCP] continueWithToolResult 失败:', continueErr);
    }
  }

  /**
   * 构建Schema提示（分阶段）
   */
  private async buildSchemaHints(err: string, failStage: number): Promise<string> {
    const { server } = this.params;

    let schemaHint = '';
    try {
      schemaHint = await buildSchemaHint(server, this.effectiveTool);
    } catch {
      /* ignore */
    }

    let detailedGuide: { text: string; spec: any } | null = null;
    try {
      detailedGuide = await buildDetailedToolGuide(server, this.effectiveTool, this.effectiveArgs || {});
    } catch {
      /* ignore */
    }

    let combinedHint = '';

    if (failStage <= 1) {
      // 第1次：仅给出简短schema示例与必填项
      combinedHint = ['参数提示（精简）：', schemaHint || '', '请按示例与必填项修正 arguments 后重试本工具。']
        .filter(Boolean)
        .join('\n');
    } else if (failStage === 2) {
      // 第2次：给出聚焦纠错摘要 + 最小可行模板
      const concise = buildConciseGuideText(detailedGuide?.spec);
      combinedHint = [
        '参数纠错建议（聚焦）：',
        concise || schemaHint || '',
        '请优先补齐缺失必填项，修正类型/枚举后再试。',
      ]
        .filter(Boolean)
        .join('\n');
    } else {
      // 第3次及以上：提供完整详细引导 + 可替代工具建议
      let toolsSuggest = '';
      try {
        const { getToolsCached } = await import('../toolsCache');
        const available = await getToolsCached(server);
        const toolList = (available || [])
          .filter((t: any) => t?.name)
          .map((t: any) => {
            const nm = String(t.name);
            const desc = t?.description ? String(t.description) : '';
            return desc ? `${nm} - ${desc}` : nm;
          })
          .slice(0, 20);

        if (toolList.length) {
          toolsSuggest = `若仍失败，可考虑改用：\n${toolList.join('\n')}`;
        }
      } catch {
        /* ignore */
      }

      combinedHint = ['详细引导：', detailedGuide?.text || schemaHint || '', toolsSuggest]
        .filter(Boolean)
        .join('\n');
    }

    return combinedHint;
  }
}

