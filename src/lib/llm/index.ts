import { ProviderRegistry } from './ProviderRegistry';
import { OllamaProvider } from './providers/OllamaProvider';
import { DeepSeekProvider } from './providers/DeepSeekProvider';
import { GoogleAIProvider } from './providers/GoogleAIProvider';
import { AnthropicProvider } from './providers/AnthropicProvider';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { OpenAICompatibleProvider } from './providers/OpenAICompatibleProvider';
import { createProviderInstance } from './strategy-factory';
import { providerRepository } from '@/lib/provider/ProviderRepository';
import { AVAILABLE_PROVIDERS_CATALOG } from '@/lib/provider/catalog';

// —— 定义 Provider 注册顺序 ——
const PROVIDER_ORDER = [
  'LM Studio',   // 1. 本地 LM Studio
  'Ollama',      // 2. 本地 Ollama
  'DeepSeek',    // 3. DeepSeek
  'Google AI',   // 4. Google AI
  'Anthropic',   // 5. Anthropic
  'OpenAI',      // 6. OpenAI
  'New API',     // 7. New API（多策略聚合，仅排序用）
];

// 同步注册所有providers，确保顺序正确
function registerAllProviders(): void {
  console.log('[llm/index] 开始按顺序注册所有providers...');
  
  // 1. LM Studio - 本地 OpenAI 兼容，默认免密
  const lmStudioProvider = new OpenAICompatibleProvider('http://localhost:1234/v1', undefined, 'LM Studio');
  // 标记无需密钥，便于运行时跳过密钥校验
  (lmStudioProvider as any).requiresKey = false;
  ProviderRegistry.register(lmStudioProvider);
  console.log('[llm/index] 1. LMStudioProvider 已注册');

  // 2. Ollama - 使用默认URL，后续会从配置中更新
  const ollamaProvider = new OllamaProvider('http://localhost:11434');
  ProviderRegistry.register(ollamaProvider);
  console.log('[llm/index] 2. OllamaProvider 已注册');

  // 3. DeepSeek
  const deepseekApiKey: string | undefined = undefined;
  ProviderRegistry.register(new DeepSeekProvider('https://api.deepseek.com', deepseekApiKey));
  console.log('[llm/index] 3. DeepSeekProvider 已注册');

  // 4. Google AI
  const googleApiKey: string | undefined = undefined;
  ProviderRegistry.register(new GoogleAIProvider('https://generativelanguage.googleapis.com/v1beta', googleApiKey));
  console.log('[llm/index] 4. GoogleAIProvider 已注册');

  // 5. Anthropic (Claude)
  const anthropicKey: string | undefined = undefined;
  ProviderRegistry.register(new AnthropicProvider('https://api.anthropic.com/v1', anthropicKey));
  console.log('[llm/index] 5. AnthropicProvider 已注册');

  // 6. OpenAI（严格解析）
  const openaiKey: string | undefined = undefined;
  ProviderRegistry.register(new OpenAIProvider('https://api.openai.com/v1', openaiKey));
  console.log('[llm/index] 6. OpenAIProvider 已注册');

  // 不再默认注册 OpenAI-Compatible，避免新安装时自动添加该 Provider。

  console.log(`[llm/index] 所有providers注册完成，共 ${ProviderRegistry.all().length} 个`);
}

// 立即执行注册
registerAllProviders();

/**
 * 同步用户新增的 Provider 到运行时注册表。
 * - 跳过 Ollama（避免覆盖内建）
 * - 未知策略默认按 openai-compatible 处理（由工厂内部兜底）
 */
export async function syncDynamicProviders(): Promise<void> {
  try {
    const list = await providerRepository.getAll();
    for (const p of list) {
      if (p.name === 'Ollama') continue;
      // 从目录中找到定义，策略/默认URL等
      const def = AVAILABLE_PROVIDERS_CATALOG.find(d => d.name === p.name);
      if (!def) {
        // 未在目录中：使用用户在 Provider 配置中保存的 strategy（若无则回退 openai-compatible）
        const inst = createProviderInstance({
          id: p.name.toLowerCase(),
          name: p.name,
          strategy: (p as any).strategy || 'openai-compatible',
          requiresKey: p.requiresKey,
          defaultUrl: p.url,
        }, p.url, p.apiKey);
        ProviderRegistry.register(inst);
        continue;
      }
      const inst = createProviderInstance(def, p.url, p.apiKey);
      // 设置 name 与 def.name 保持一致（Provider 子类构造器已固定 name），若不一致可忽略
      ProviderRegistry.register(inst);
    }
  } catch (e) {
    console.warn('[llm/index] syncDynamicProviders failed:', e);
  }
}

// 异步更新OllamaProvider的URL配置
async function updateOllamaProviderConfig(): Promise<void> {
  try {
    const ollamaProvider = ProviderRegistry.get('Ollama') as OllamaProvider;
    if (!ollamaProvider) {
      console.warn('[llm/index] OllamaProvider未找到，无法更新配置');
      return;
    }

    // 优先从OllamaConfigService获取配置
    const { OllamaConfigService } = await import('@/lib/config/OllamaConfigService');
    let ollamaUrl = await OllamaConfigService.getOllamaUrl();
    
    // 如果OllamaConfigService没有配置，从ProviderRepository获取
    if (!ollamaUrl || ollamaUrl === 'http://localhost:11434') {
      const { providerRepository } = await import('@/lib/provider/ProviderRepository');
      const providerList = await providerRepository.getAll();
      const saved = providerList.find(p => p.name === 'Ollama');
      if (saved && saved.url && saved.url.trim() && saved.url !== 'http://localhost:11434') {
        ollamaUrl = saved.url;
        console.log(`[llm/index] 使用 ProviderRepository 配置的 URL: ${saved.url}`);
      }
    }
    
    // 确保有有效的URL
    if (!ollamaUrl || ollamaUrl === 'http://localhost:11434') {
      ollamaUrl = 'http://localhost:11434';
      console.log(`[llm/index] 使用默认 URL: ${ollamaUrl}`);
    } else {
      console.log(`[llm/index] 使用配置的 URL: ${ollamaUrl}`);
    }
    
    // 更新OllamaProvider的baseUrl
    (ollamaProvider as any).baseUrl = ollamaUrl;
    console.log(`[llm/index] OllamaProvider URL 已更新: ${ollamaUrl}`);
  } catch (error) {
    console.warn('[llm/index] 更新OllamaProvider配置失败:', error);
  }
}

import { LLMInterpreter } from './interpreter';

let _interpreterInstance: LLMInterpreter | null = null;

export async function initializeLLM(forceUpdate = false): Promise<boolean> {
  try {
    // 确保所有providers都已注册
    if (ProviderRegistry.all().length === 0) {
      console.warn('[initializeLLM] 检测到ProviderRegistry为空，重新注册providers');
      registerAllProviders();
    }
    
    // 异步更新OllamaProvider配置
    await updateOllamaProviderConfig();
    // 同步用户新增的 providers 到运行时注册表
    await syncDynamicProviders();
    
    if (!_interpreterInstance) {
      _interpreterInstance = new LLMInterpreter();
    }
    await _interpreterInstance.initialize(forceUpdate);
    return true;
  } catch (err) {
    console.error('[initializeLLM] 初始化失败', err);
    return false;
  }
}

// 添加更新OllamaProvider URL的函数
export async function updateOllamaProviderUrl(newUrl: string): Promise<void> {
  try {
    const ollamaProvider = ProviderRegistry.get('Ollama') as OllamaProvider;
    if (ollamaProvider) {
      // 如果URL为空，使用默认值
      const effectiveUrl = newUrl.trim() || 'http://localhost:11434';
      (ollamaProvider as any).baseUrl = effectiveUrl;
      console.log(`[llm/index] 已更新 OllamaProvider URL: ${effectiveUrl}`);
    }
  } catch (error) {
    console.error('[llm/index] 更新 OllamaProvider URL 失败:', error);
  }
}

export function getInterpreter(): LLMInterpreter | null {
  return _interpreterInstance;
}

// ---- 类型 re-export ----
export type { Message, StreamCallbacks } from './types';

// ---- 兼容旧 Hook 包装函数 ----
export async function chat(
  provider: string,
  model: string,
  messages: import('./types').Message[],
  options: Record<string, any> = {}
): Promise<{ content: string; raw: any }> {
  await initializeLLM();
  const inst = getInterpreter();
  if (!inst) throw new Error('LLMInterpreter not initialized');
  return inst.chat(provider, model, messages as any, options);
}

export async function streamChat(
  provider: string,
  model: string,
  messages: import('./types').Message[],
  callbacks: import('./types').StreamCallbacks,
  options: Record<string, any> = {}
) {
  await initializeLLM();
  const inst = getInterpreter();
  if (!inst) throw new Error('LLMInterpreter not initialized');
  return inst.streamChat(provider, model, messages as any, callbacks as any, options);
}

export function cancelStream(requestId?: string) {
  const inst = getInterpreter();
  if (inst) {
    inst.cancelStream(requestId);
  }
}

export { ProviderRegistry, PROVIDER_ORDER };

// 工具调用配置
export * from './config';
export * from './types';

