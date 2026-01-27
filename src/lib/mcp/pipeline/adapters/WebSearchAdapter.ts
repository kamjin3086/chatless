import { invoke } from '@tauri-apps/api/core';

import { WEB_SEARCH_SERVER_NAME } from '@/lib/mcp/nativeTools/webSearch';
import { mcpCallHistory } from '@/lib/mcp/callHistory';
import { getProviderCredentials, isMissingRequiredCredentials } from '@/lib/websearch/registry';
import { useWebSearchStore } from '@/store/webSearchStore';
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

export class WebSearchAdapter implements ToolAdapter {
  readonly server = WEB_SEARCH_SERVER_NAME;

  canHandle(invocation: ToolInvocation): boolean {
    return invocation.server === WEB_SEARCH_SERVER_NAME;
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    const tool = String(invocation.tool || '').trim();
    const args = invocation.args || {};

    // Cache hit
    if (mcpCallHistory.isDuplicateCall(WEB_SEARCH_SERVER_NAME, tool, args)) {
      const recent = mcpCallHistory.getRecentResult(WEB_SEARCH_SERVER_NAME, tool, args);
      if (recent) return recent;
    }

    const cfg = useWebSearchStore.getState();
    const providerToUse = cfg.getConversationProvider(invocation.conversationId) || cfg.provider;

    const missingKey = isMissingRequiredCredentials(providerToUse as any, {
      apiKeyGoogle: cfg.apiKeyGoogle,
      cseIdGoogle: cfg.cseIdGoogle,
      apiKeyBing: cfg.apiKeyBing,
      apiKeyOllama: (cfg as any).apiKeyOllama,
    });

    if (missingKey) {
      throw new Error('WEB_SEARCH_CREDENTIALS_MISSING');
    }

    const { apiKey, cseId } = getProviderCredentials(providerToUse as any, {
      apiKeyGoogle: cfg.apiKeyGoogle,
      cseIdGoogle: cfg.cseIdGoogle,
      apiKeyBing: cfg.apiKeyBing,
      apiKeyOllama: (cfg as any).apiKeyOllama,
    });

    let result: unknown;

    if (tool === 'fetch') {
      const url = typeof (args as any).url === 'string' ? String((args as any).url) : '';
      if (!url.trim()) throw new Error('MISSING_REQUIRED_ARGUMENT: url');
      const request: any = { provider: providerToUse, url, apiKey };
      // 通用 fetch 高级选项
      request.maxLinks = (cfg as any).fetchMaxLinks;
      request.maxContentChars = (cfg as any).fetchMaxContentChars;
      request.useReadability = !!(cfg as any).fetchUseReadability;
      result = await invoke('native_web_fetch', { request });
    } else {
      // 默认 search
      const query = typeof (args as any).query === 'string' ? String((args as any).query) : '';
      if (!query.trim()) throw new Error('MISSING_REQUIRED_ARGUMENT: query');
      const request: any = { provider: providerToUse, query, apiKey, cseId };

      // 高级参数
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

      result = await invoke('native_web_search', { request });
    }

    mcpCallHistory.recordCall(WEB_SEARCH_SERVER_NAME, tool, args, true, result);
    return result;
  }
}

