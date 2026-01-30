import { invoke } from '@tauri-apps/api/core';
import { writeFile, mkdir, exists } from '@tauri-apps/plugin-fs';
import { appDataDir, join, dirname } from '@tauri-apps/api/path';

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

    if (tool === 'download') {
      result = await this.handleDownload(args);
    } else if (tool === 'fetch') {
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

  /**
   * 处理文件下载
   */
  private async handleDownload(args: Record<string, unknown>): Promise<{
    success: boolean;
    path?: string;
    size?: number;
    message: string;
  }> {
    const url = typeof args.url === 'string' ? args.url.trim() : '';
    const savePath = typeof args.savePath === 'string' ? args.savePath.trim() : '';
    const customFilename = typeof args.filename === 'string' ? args.filename.trim() : '';

    if (!url) {
      return { success: false, message: 'Error: url is required' };
    }
    if (!savePath) {
      return { success: false, message: 'Error: savePath is required' };
    }

    try {
      // 解析保存路径
      let fullPath: string;
      if (savePath.startsWith('@WorkDir')) {
        const dataDir = await appDataDir();
        const relativePath = savePath.replace(/^@WorkDir\/?/, '');
        fullPath = await join(dataDir, relativePath);
      } else if (savePath.startsWith('/') || /^[a-zA-Z]:/.test(savePath)) {
        // 绝对路径
        fullPath = savePath;
      } else {
        // 相对路径，默认在 appDataDir
        const dataDir = await appDataDir();
        fullPath = await join(dataDir, savePath);
      }

      // 如果指定了自定义文件名，替换路径中的文件名
      if (customFilename) {
        const dir = await dirname(fullPath);
        fullPath = await join(dir, customFilename);
      }

      // 确保目录存在
      const dir = await dirname(fullPath);
      const dirExists = await exists(dir);
      if (!dirExists) {
        await mkdir(dir, { recursive: true });
      }

      // 下载文件
      const response = await fetch(url);
      if (!response.ok) {
        return { 
          success: false, 
          message: `Download failed: HTTP ${response.status} ${response.statusText}` 
        };
      }

      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // 写入文件
      await writeFile(fullPath, uint8Array);

      return {
        success: true,
        path: fullPath,
        size: uint8Array.length,
        message: `Downloaded successfully: ${fullPath} (${this.formatSize(uint8Array.length)})`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Download error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 格式化文件大小
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

