import { BaseProvider } from './providers/BaseProvider';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { OpenAICompatibleProvider } from './providers/OpenAICompatibleProvider';
import { AnthropicProvider } from './providers/AnthropicProvider';
import { GoogleAIProvider } from './providers/GoogleAIProvider';
import { DeepSeekProvider } from './providers/DeepSeekProvider';
import { OllamaProvider } from './providers/OllamaProvider';
import { OpenAIResponsesProvider } from './providers/OpenAIResponsesProvider';
import { OrcaRouterProvider } from './providers/OrcaRouterProvider';
import type { CatalogProviderDef } from '@/lib/provider/catalog';

/**
 * 简易工厂：根据目录定义创建 Provider 实例。
 * openai-compatible 默认复用 OpenAIProvider 行为（/v1/models、/v1/chat/completions）。
 */
export function createProviderInstance(def: CatalogProviderDef, url: string, apiKey?: string | null): BaseProvider {
  const baseUrl = (url || '').trim();
  class InlineMultiStrategyProvider extends BaseProvider {
    constructor(displayName: string, base: string, key?: string | null) {
      super(displayName, base, key);
    }
    async checkConnection() {
      const key = await this.getApiKey();
      if (!key) return { ok: false, reason: 'NO_KEY', message: 'NO_KEY' } as const;
      
      // 使用专门的连通性检查函数
      const baseUrl = this.baseUrl.replace(/\/$/, '');
      console.log(`[InlineMultiStrategyProvider] 开始检查网络连通性: ${baseUrl}`);
      
      const { checkConnectivity } = await import('@/lib/request');
      const result = await checkConnectivity(baseUrl, {
        timeout: 5000,
        debugTag: 'InlineMultiStrategyProvider-Connectivity'
      });
      
      if (result.ok) {
        console.log(`[InlineMultiStrategyProvider] 网络连通性检查成功，状态码: ${result.status}`);
        return { ok: true, message: '网络连接正常' } as const;
      } else {
        console.error(`[InlineMultiStrategyProvider] 网络连通性检查失败: ${result.reason}`, result.error);
        
        switch (result.reason) {
          case 'TIMEOUT':
            return { ok: false, reason: 'TIMEOUT', message: '连接超时' } as const;
          case 'NETWORK':
            return { ok: false, reason: 'NETWORK', message: '网络连接失败' } as const;
          default:
            return { ok: false, reason: 'UNKNOWN', message: result.error || '未知错误' } as const;
        }
      }
    }
    private async getModelStrategy(model: string): Promise<'openai'|'openai-responses'|'openai-compatible'|'anthropic'|'gemini'|'deepseek'> {
      try {
        const { specializedStorage } = await import('@/lib/storage');
        const override = await specializedStorage.models.getModelStrategy(this.name, model);
        if (override && (['openai','openai-responses','openai-compatible','anthropic','gemini','deepseek'] as string[]).includes(override)) return override as any;
        // 移除Provider默认策略的回退，因为聚合型提供商应该为每个模型单独设置策略
        // const def = await specializedStorage.models.getProviderDefaultStrategy(this.name);
        // if (def && (['openai','openai-responses','openai-compatible','anthropic','gemini','deepseek'] as string[]).includes(def)) return def as any;
      } catch (_) {}
      return 'openai-compatible';
    }
    private async createDelegate(strategy: string) {
      const key = await this.getApiKey();
      switch (strategy) {
        case 'openai': { const p = new OpenAIProvider(this.baseUrl, key || undefined, this.name); (p as any).aliasProviderName = this.name; return p; }
        case 'openai-responses': { const p = new OpenAIResponsesProvider(this.baseUrl, key || undefined, this.name); (p as any).aliasProviderName = this.name; return p; }
        case 'anthropic': { const p = new AnthropicProvider(this.baseUrl, key || undefined); (p as any).aliasProviderName = this.name; return p; }
        case 'gemini': { const p = new GoogleAIProvider(this.baseUrl, key || undefined); (p as any).aliasProviderName = this.name; return p; }
        case 'deepseek': { const p = new DeepSeekProvider(this.baseUrl, key || undefined); (p as any).aliasProviderName = this.name; return p; }
        case 'openai-compatible':
        default: { const p = new OpenAICompatibleProvider(this.baseUrl, key || undefined, this.name); (p as any).aliasProviderName = this.name; return p; }
      }
    }
    async chatStream(model: string, messages: any[], callbacks: any, options: Record<string, any> = {}) {
      const strat = await this.getModelStrategy(model);
      const delegate = await this.createDelegate(strat);
      (delegate as any).baseUrl = this.baseUrl;
      return delegate.chatStream(model, messages, callbacks, options);
    }
  }
  switch (def.strategy) {
    case 'openai':
      { const inst = new OpenAIProvider(
          baseUrl || def.defaultUrl || 'https://api.openai.com/v1',
          apiKey || undefined,
          def.name
        ); (inst as any).requiresKey = !!def.requiresKey; return inst; }
    case 'openai-responses':
      { const inst = new OpenAIResponsesProvider(
          baseUrl || def.defaultUrl || 'https://api.openai.com/v1',
          apiKey || undefined,
          def.name
        ); (inst as any).requiresKey = !!def.requiresKey; return inst; }
    case 'openai-compatible':
      { const inst = new OpenAICompatibleProvider(
          baseUrl || def.defaultUrl || 'https://api.openai.com/v1',
          apiKey || undefined,
          def.name
        ); (inst as any).requiresKey = !!def.requiresKey; return inst; }
    case 'orcarouter':
      { const inst = new OrcaRouterProvider(
          baseUrl || def.defaultUrl || 'https://api.orcarouter.ai/v1',
          apiKey || undefined,
          def.name
        ); (inst as any).requiresKey = !!def.requiresKey; return inst; }
    case 'anthropic':
      { const inst = new AnthropicProvider(baseUrl || def.defaultUrl || 'https://api.anthropic.com/v1', apiKey || undefined); (inst as any).requiresKey = !!def.requiresKey; return inst; }
    case 'gemini':
      { const inst = new GoogleAIProvider(baseUrl || def.defaultUrl || 'https://generativelanguage.googleapis.com/v1beta', apiKey || undefined); (inst as any).requiresKey = !!def.requiresKey; return inst; }
    case 'deepseek':
      { const inst = new DeepSeekProvider(baseUrl || def.defaultUrl || 'https://api.deepseek.com', apiKey || undefined); (inst as any).requiresKey = !!def.requiresKey; return inst; }
    case 'ollama':
      return new OllamaProvider(baseUrl || 'http://localhost:11434');
    case 'multi':
      return new InlineMultiStrategyProvider(def.name, baseUrl || def.defaultUrl || '', apiKey || undefined);
    default:
      { const inst = new OpenAICompatibleProvider(baseUrl || def.defaultUrl || 'https://api.openai.com/v1', apiKey || undefined); (inst as any).requiresKey = !!def.requiresKey; return inst; }
  }
}


