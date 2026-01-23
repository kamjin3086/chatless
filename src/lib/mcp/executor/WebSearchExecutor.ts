/**
 * Web搜索工具执行器
 * 
 * 负责处理web_search原生工具的所有逻辑，包括：
 * - 授权检查
 * - 密钥验证
 * - 参数验证  
 * - 搜索/抓取执行
 * - 错误处理
 */

import { invoke } from '@tauri-apps/api/core';
import { useChatStore } from '@/store/chatStore';
import { useAuthorizationStore } from '@/store/authorizationStore';
import { useWebSearchStore } from '@/store/webSearchStore';
import { getProviderCredentials, isMissingRequiredCredentials } from '@/lib/websearch/registry';
import { WEB_SEARCH_TOOL_SCHEMA, WEB_FETCH_TOOL_SCHEMA } from '../nativeTools/webSearch';
import { mcpCallHistory } from '../callHistory';
import { shouldAutoAuthorize } from '../authorizationConfig';
import type { ToolCallParams } from './types';

/**
 * Web搜索执行器类
 */
export class WebSearchExecutor {
  private params: ToolCallParams;
  private callKey: string;

  constructor(params: ToolCallParams, callKey: string) {
    this.params = params;
    this.callKey = callKey;
  }

  /**
   * 执行web搜索工具调用
   */
  async execute(): Promise<void> {
    const {
      conversationId,
      tool: originalTool,
      args,
      cardId,
    } = this.params;

    const effectiveTool = originalTool;
    const effectiveArgs = args || {};

    try {
      // 1. 授权检查
      const authorized = await this.checkAuthorization(effectiveTool, effectiveArgs, cardId);
      if (!authorized) return;

      // 2. 检查缓存
      const cachedResult = await this.checkCache(effectiveTool, effectiveArgs, cardId);
      if (cachedResult !== null) return;

      // 3. 获取配置和凭证
      const cfg = useWebSearchStore.getState();
      const conversationProvider = cfg.getConversationProvider(conversationId);
      const providerToUse = conversationProvider || cfg.provider;
      const { apiKey, cseId } = getProviderCredentials(providerToUse as any, {
        apiKeyGoogle: cfg.apiKeyGoogle,
        cseIdGoogle: cfg.cseIdGoogle,
        apiKeyBing: cfg.apiKeyBing,
        apiKeyOllama: (cfg as any).apiKeyOllama,
      });

      // 4. 提取参数
      const query = typeof (effectiveArgs as any)?.query === 'string' 
        ? String((effectiveArgs as any).query) 
        : '';
      const url = typeof (effectiveArgs as any)?.url === 'string' 
        ? String((effectiveArgs as any).url) 
        : '';

      // 5. 记录调试信息
      this.logDebugInfo(providerToUse, apiKey, cseId, effectiveTool, query);

      // 6. 验证密钥
      const credentialsValid = await this.validateCredentials(
        providerToUse,
        apiKey,
        cseId,
        cfg,
        effectiveTool
      );
      if (!credentialsValid) return;

      // 7. 验证参数
      const argsValid = await this.validateArguments(effectiveTool, query, url);
      if (!argsValid) return;

      // 8. 执行搜索/抓取
      const result = await this.executeSearch(
        effectiveTool,
        providerToUse,
        query,
        url,
        apiKey,
        cseId,
        cfg
      );

      // 9. 记录成功并继续追问
      await this.handleSuccess(effectiveTool, effectiveArgs, result);
    } catch (e) {
      // 10. 错误处理
      await this.handleError(e, effectiveTool, effectiveArgs);
    }
  }

  /**
   * 检查授权
   */
  private async checkAuthorization(
    tool: string,
    args: Record<string, unknown>,
    cardId?: string
  ): Promise<boolean> {
    const { assistantMessageId, server, conversationId, provider, model, historyForLlm, originalUserContent } = this.params;
    
    const autoAuth = await shouldAutoAuthorize(server);
    if (autoAuth) return true;

    const effectiveCardId = cardId || crypto.randomUUID();
    const st = useChatStore.getState();

    if (!cardId) {
      st.dispatchMessageAction(assistantMessageId, {
        type: 'TOOL_RESULT',
        server,
        tool,
        ok: false,
        errorMessage: 'pending_auth',
        cardId: effectiveCardId,
      });
    }

    const authorized = await new Promise<boolean>((resolve) => {
      const authStore = useAuthorizationStore.getState();
      authStore.addPendingAuthorization({
        id: effectiveCardId,
        messageId: assistantMessageId,
        server,
        tool,
        args: args || {},
        createdAt: Date.now(),
        onApprove: () => resolve(true),
        onReject: () => resolve(false),
      });
    });

    if (!authorized) {
      st.dispatchMessageAction(assistantMessageId, {
        type: 'TOOL_RESULT',
        server,
        tool,
        ok: false,
        errorMessage: '用户拒绝授权此工具调用',
        cardId: effectiveCardId,
      });
      
      // 导入continueWithToolResult
      const ToolCallOrchestrator = await import('../ToolCallOrchestrator');
      const continueWithToolResult = ToolCallOrchestrator.continueWithToolResult;
      await continueWithToolResult({
        assistantMessageId,
        provider,
        model,
        conversationId,
        historyForLlm,
        originalUserContent,
        server,
        tool,
        args: args || {},
        result: {
          error: 'AUTHORIZATION_DENIED',
          message: '用户拒绝了此工具调用。这可能是因为用户认为此调用不合理或参数有误。',
        },
      });
    }

    return authorized;
  }

  /**
   * 检查缓存
   */
  private async checkCache(
    tool: string,
    args: Record<string, unknown>,
    cardId?: string
  ): Promise<unknown | null> {
    const { assistantMessageId, server, conversationId, provider, model, historyForLlm, originalUserContent } = this.params;

    if (mcpCallHistory.isDuplicateCall(server, tool, args)) {
      const recent = mcpCallHistory.getRecentResult(server, tool, args);
      if (recent) {
        const st = useChatStore.getState();
        const resultPreview = typeof recent === 'string' 
          ? recent.slice(0, 12000) 
          : JSON.stringify(recent).slice(0, 12000);
        
        st.dispatchMessageAction(assistantMessageId, {
          type: 'TOOL_RESULT',
          server,
          tool,
          ok: true,
          resultPreview,
          cardId,
        });
        
        const ToolCallOrchestrator = await import('../ToolCallOrchestrator');
        const continueWithToolResult = ToolCallOrchestrator.continueWithToolResult;
        await continueWithToolResult({
          assistantMessageId,
          provider,
          model,
          conversationId,
          historyForLlm,
          originalUserContent,
          server,
          tool,
          args: args || {},
          result: recent,
        });
        
        return recent;
      }
    }

    return null;
  }

  /**
   * 记录调试信息
   */
  private logDebugInfo(
    providerToUse: string,
    apiKey: string | undefined,
    cseId: string | undefined,
    tool: string,
    query: string
  ): void {
    const { conversationId, assistantMessageId } = this.params;

    try {
      console.log('[WEB_SEARCH] plan', {
        provider: providerToUse,
        hasApiKey: !!apiKey,
        hasCseId: !!cseId,
        conversationId,
        messageId: assistantMessageId,
        tool,
        queryPreview: (query || '').slice(0, 200),
      });
    } catch {
      /* noop */
    }
  }

  /**
   * 验证密钥
   */
  private async validateCredentials(
    providerToUse: string,
    apiKey: string | undefined,
    cseId: string | undefined,
    cfg: any,
    tool: string
  ): Promise<boolean> {
    const { assistantMessageId, server, conversationId, provider, model, historyForLlm, originalUserContent } = this.params;
    const { cardId } = this.params;

    const missingKey = isMissingRequiredCredentials(providerToUse as any, {
      apiKeyGoogle: cfg.apiKeyGoogle,
      cseIdGoogle: cfg.cseIdGoogle,
      apiKeyBing: cfg.apiKeyBing,
      apiKeyOllama: (cfg as any).apiKeyOllama,
    });

    if (missingKey) {
      const msg = '未配置相关网络搜索密钥，请切换到其他可用的搜索提供商。';
      
      try {
        const { toast } = await import('@/components/ui/sonner');
        toast.error('网络搜索不可用', { description: msg });
      } catch {
        /* ignore */
      }

      const st = useChatStore.getState();
      try {
        st.appendTextToMessageSegments(assistantMessageId, msg);
      } catch {
        /* noop */
      }

      st.dispatchMessageAction(assistantMessageId, {
        type: 'TOOL_RESULT',
        server,
        tool,
        ok: false,
        errorMessage: msg,
        cardId,
      });

      try {
        console.warn('[WEB_SEARCH] missing credentials', {
          provider: providerToUse,
          hasApiKey: !!apiKey,
          hasCseId: !!cseId,
        });
      } catch {
        /* noop */
      }

      const ToolCallOrchestrator = await import('../ToolCallOrchestrator');
      const continueWithToolResult = ToolCallOrchestrator.continueWithToolResult;
      await continueWithToolResult({
        assistantMessageId,
        provider,
        model,
        conversationId,
        historyForLlm,
        originalUserContent,
        server,
        tool,
        args: (this.params.args as any) || {},
        result: { error: 'WEB_SEARCH_CREDENTIALS_MISSING', message: msg },
      });

      return false;
    }

    return true;
  }

  /**
   * 验证参数
   */
  private async validateArguments(
    tool: string,
    query: string,
    url: string
  ): Promise<boolean> {
    if (tool === 'search') {
      if (!query || !query.trim()) {
        return await this.handleMissingQueryParam();
      }
    } else if (tool === 'fetch') {
      if (!url || !url.trim()) {
        return await this.handleMissingUrlParam();
      }
    }

    return true;
  }

  /**
   * 处理缺少query参数
   */
  private async handleMissingQueryParam(): Promise<false> {
    const { assistantMessageId, server, conversationId, provider, model, historyForLlm, originalUserContent } = this.params;
    const { cardId } = this.params;
    const tool = 'search';

    const schema: any =
      (WEB_SEARCH_TOOL_SCHEMA as any)?.input_schema?.schema ||
      (WEB_SEARCH_TOOL_SCHEMA as any)?.input_schema ||
      { properties: { query: { type: 'string' } }, required: ['query'] };
    
    const required: string[] = Array.isArray(schema?.required) ? schema.required : ['query'];
    const queryDesc = String(schema?.properties?.query?.description || '搜索关键词（中文自然语言）');
    
    const schemaHint = [
      '参数提示（web_search.search）:',
      `required: ${required.join(', ')}`,
      `params:`,
      ` - query (string) [required] - ${queryDesc}`,
      `示例: {"query":"北京今天的天气"}`,
    ].join('\n');

    const st = useChatStore.getState();
    st.dispatchMessageAction(assistantMessageId, {
      type: 'TOOL_RESULT',
      server,
      tool,
      ok: false,
      errorMessage: '缺少必填参数 query',
      schemaHint,
      cardId,
    });

    const ToolCallOrchestrator = await import('../ToolCallOrchestrator');
    const continueWithToolResult = ToolCallOrchestrator.continueWithToolResult;
    await continueWithToolResult({
      assistantMessageId,
      provider,
      model,
      conversationId,
      historyForLlm,
      originalUserContent,
      server,
      tool,
      args: (this.params.args as any) || {},
      result: { error: 'MISSING_REQUIRED_ARGUMENT', message: 'query is required', schemaHint },
    });

    return false;
  }

  /**
   * 处理缺少url参数
   */
  private async handleMissingUrlParam(): Promise<false> {
    const { assistantMessageId, server, conversationId, provider, model, historyForLlm, originalUserContent } = this.params;
    const { cardId } = this.params;
    const tool = 'fetch';

    const schema: any =
      (WEB_FETCH_TOOL_SCHEMA as any)?.input_schema?.schema ||
      (WEB_FETCH_TOOL_SCHEMA as any)?.input_schema ||
      { properties: { url: { type: 'string' } }, required: ['url'] };
    
    const required: string[] = Array.isArray(schema?.required) ? schema.required : ['url'];
    const urlDesc = String(schema?.properties?.url?.description || '要抓取的网页地址（http/https）');
    
    const schemaHint = [
      '参数提示（web_search.fetch）:',
      `required: ${required.join(', ')}`,
      `params:`,
      ` - url (string) [required] - ${urlDesc}`,
      `示例: {"url":"https://example.com"}`,
    ].join('\n');

    const st = useChatStore.getState();
    st.dispatchMessageAction(assistantMessageId, {
      type: 'TOOL_RESULT',
      server,
      tool,
      ok: false,
      errorMessage: '缺少必填参数 url',
      schemaHint,
      cardId,
    });

    const ToolCallOrchestrator = await import('../ToolCallOrchestrator');
    const continueWithToolResult = ToolCallOrchestrator.continueWithToolResult;
    await continueWithToolResult({
      assistantMessageId,
      provider,
      model,
      conversationId,
      historyForLlm,
      originalUserContent,
      server,
      tool,
      args: (this.params.args as any) || {},
      result: { error: 'MISSING_REQUIRED_ARGUMENT', message: 'url is required', schemaHint },
    });

    return false;
  }

  /**
   * 执行搜索或抓取
   */
  private async executeSearch(
    tool: string,
    providerToUse: string,
    query: string,
    url: string,
    apiKey: string | undefined,
    cseId: string | undefined,
    cfg: any
  ): Promise<any> {
    let result: any;

    if (tool === 'fetch') {
      result = await this.executeFetch(providerToUse, url, apiKey, cfg);
    } else {
      result = await this.executeSearchQuery(providerToUse, query, apiKey, cseId, cfg);
    }

    return result;
  }

  /**
   * 执行fetch
   */
  private async executeFetch(
    providerToUse: string,
    url: string,
    apiKey: string | undefined,
    cfg: any
  ): Promise<any> {
    const request: any = { provider: providerToUse, url, apiKey };

    // 通用 fetch 高级选项
    try {
      request.maxLinks = (cfg as any).fetchMaxLinks;
      request.maxContentChars = (cfg as any).fetchMaxContentChars;
      request.useReadability = !!(cfg as any).fetchUseReadability;
    } catch {
      /* noop */
    }

    try {
      console.log('[WEB_SEARCH] invoke(native_web_fetch) -> start', {
        provider: providerToUse,
        hasApiKey: !!apiKey,
        urlPreview: (url || '').slice(0, 200),
      });
    } catch {
      /* noop */
    }

    return await invoke('native_web_fetch', { request });
  }

  /**
   * 执行搜索查询
   */
  private async executeSearchQuery(
    providerToUse: string,
    query: string,
    apiKey: string | undefined,
    cseId: string | undefined,
    cfg: any
  ): Promise<any> {
    const request: any = { provider: providerToUse, query, apiKey, cseId };

    // 按 provider 注入高级参数
    if (providerToUse === 'duckduckgo' || providerToUse === 'custom_scrape') {
      request.limit = (cfg as any).ddgLimit;
      if ((cfg as any).ddgKl) request.kl = (cfg as any).ddgKl;
      if ((cfg as any).ddgAcceptLanguage) request.acceptLanguage = (cfg as any).ddgAcceptLanguage;
      request.safe = !!(cfg as any).ddgSafe;
      if ((cfg as any).ddgSite) request.site = (cfg as any).ddgSite;
    } else if (providerToUse === 'ollama') {
      if (typeof (cfg as any).ollamaMaxResults === 'number') {
        request.maxResults = (cfg as any).ollamaMaxResults;
      }
    }

    try {
      console.log('[WEB_SEARCH] invoke(native_web_search) -> start', {
        provider: providerToUse,
        hasApiKey: !!apiKey,
        hasCseId: !!cseId,
        queryPreview: (query || '').slice(0, 200),
      });
    } catch {
      /* noop */
    }

    const result = await invoke('native_web_search', { request });

    try {
      if (Array.isArray(result)) {
        console.log('[WEB_SEARCH] invoke(native_web_search) -> ok', {
          count: result.length,
          first: (result as unknown[])[0],
        });
      } else {
        const previewStr = typeof result === 'string' ? result : JSON.stringify(result ?? {}).slice(0, 300);
        console.log('[WEB_SEARCH] invoke(native_web_search) -> ok', previewStr);
      }
    } catch {
      /* noop */
    }

    return result;
  }

  /**
   * 处理成功
   */
  private async handleSuccess(tool: string, args: Record<string, unknown>, result: any): Promise<void> {
    const { assistantMessageId, server, conversationId, provider, model, historyForLlm, originalUserContent, cardId } = this.params;

    // 记录成功
    mcpCallHistory.recordCall(server, tool, args, true, result);
    
    const st = useChatStore.getState();
    const resultPreview = typeof result === 'string' ? result.slice(0, 12000) : JSON.stringify(result).slice(0, 12000);
    
    st.dispatchMessageAction(assistantMessageId, {
      type: 'TOOL_RESULT',
      server,
      tool,
      ok: true,
      resultPreview,
      cardId,
    });

    const ToolCallOrchestrator = await import('../ToolCallOrchestrator');
    const continueWithToolResult = ToolCallOrchestrator.continueWithToolResult;
    await continueWithToolResult({
      assistantMessageId,
      provider,
      model,
      conversationId,
      historyForLlm,
      originalUserContent,
      server,
      tool,
      args,
      result,
    });
  }

  /**
   * 处理错误
   */
  private async handleError(e: unknown, tool: string, args: Record<string, unknown>): Promise<void> {
    const { assistantMessageId, server, conversationId, provider, model, historyForLlm, originalUserContent, cardId } = this.params;
    const err = e instanceof Error ? e.message : String(e);

    try {
      console.error('[WEB_SEARCH] invoke(native_web_search) -> error', {
        error: err,
        provider: (useWebSearchStore.getState().getConversationProvider(conversationId) || useWebSearchStore.getState().provider),
        messageId: assistantMessageId,
        tool,
      });
    } catch {
      /* noop */
    }

    mcpCallHistory.recordCall(server, tool, args, false);
    
    const st = useChatStore.getState();
    const hint = `原生网络搜索 ${server}.${tool} 失败: ${err}`;
    
    st.dispatchMessageAction(assistantMessageId, {
      type: 'TOOL_RESULT',
      server,
      tool,
      ok: false,
      errorMessage: err,
      schemaHint: hint,
      cardId,
    });

    const ToolCallOrchestrator = await import('../ToolCallOrchestrator');
    const continueWithToolResult = ToolCallOrchestrator.continueWithToolResult;
    await continueWithToolResult({
      assistantMessageId,
      provider,
      model,
      conversationId,
      historyForLlm,
      originalUserContent,
      server,
      tool,
      args,
      result: { error: 'CALL_TOOL_FAILED', message: err, schemaHint: hint },
    });
  }
}

