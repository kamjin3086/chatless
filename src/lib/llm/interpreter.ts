"use client";

import { Message, StreamCallbacks, ChatOptions } from './types';
import type { BaseProvider } from './providers/BaseProvider';
// removed unused imports
import { ProviderRegistry } from './index';
import { ParameterPolicyEngine } from './ParameterPolicy';
import { OpenAICompatibleProvider } from './providers/OpenAICompatibleProvider';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { GoogleAIProvider } from './providers/GoogleAIProvider';
import { AnthropicProvider } from './providers/AnthropicProvider';
import { DeepSeekProvider } from './providers/DeepSeekProvider';
import type { ToolDefinition } from './types/tool-schema';

/**
 * 简化版 LLMInterpreter：
 *  1. 仅依赖 ProviderRegistry 中已注册的 Provider 策略。
 *  2. 不再支持旧 metadata.json / 模板化请求的兼容路径。
 */
export class LLMInterpreter {
  /**
   * 非流式 chat：内部调用 streamChat 聚合 token 后返回。
   */
  async chat(
    provider: string,
    model: string,
    messages: Message[],
    options: ChatOptions = {}
  ): Promise<{ content: string; raw: any }> {
    let content = '';
    let thinkingContent = ''; // 收集思考内容
    // 确保等待到 onComplete 后再返回，避免 Provider 流实现"立即 resolve"导致返回空字符串
    let resolveDone: (() => void) | null = null;
    let rejectDone: ((e: Error) => void) | null = null;
    const donePromise = new Promise<void>((resolve, reject) => {
      resolveDone = resolve; rejectDone = reject;
    });

    // 标记为内部调用，避免干扰UI层的流式状态
    const internalOptions = { 
      ...options, 
      __internal: true,  // 标记为内部调用
      __silentMode: true // 静默模式，不触发UI更新
    };

    await this.streamChat(
      provider,
      model,
      messages,
      {
        // 优先使用 onEvent 回调（新架构：Provider 只发射结构化事件）
        onEvent: (event: import('./types/stream-events').StreamEvent) => {
          // 从 content_token 事件中提取内容
          if (event.type === 'content_token' && typeof event.content === 'string') {
            content += event.content;
          }
          // 同时收集 thinking_token（某些模型如 Qwen 会输出思考过程）
          if (event.type === 'thinking_token' && typeof event.content === 'string') {
            thinkingContent += event.content;
          }
        },
        // 保留 onToken 作为后备（兼容可能仍使用 onToken 的 Provider）
        onToken: (t: string) => { content += t; },
        onComplete: () => { if (resolveDone) resolveDone(); },
        onError: (e: Error) => { if (rejectDone) rejectDone(e); },
        // 添加标记，表示这是内部调用
        __internal: true,
      } as any,
      internalOptions
    ).catch(() => {});

    try { await donePromise; } catch { /* 忽略，交由上层回退 */ }
    // 如果正文内容为空但有思考内容，返回思考内容（供标题生成等场景使用）
    const finalContent = content || thinkingContent;
    return { content: finalContent, raw: null };
  }

  // Provider instances own transport state.  Keep that state associated with
  // the request that created it; a shared "active provider" makes stopping
  // one conversation cancel whichever request happened to start last.
  private activeProviders = new Map<string, BaseProvider>();

  /** 初始化占位（保持与旧 API 兼容） */
  async initialize(_forceUpdate = false): Promise<void> {
    // 新实现无需任何预处理，直接返回。
    return;
  }

  /** 取消当前正在进行的流式请求 */
  cancelStream(requestId?: string): void {
    const key = requestId || '__legacy__';
    // 0. Notify only the provider that owns this request.
    try {
      this.activeProviders.get(key)?.cancelStream?.();
    } catch { /* ignore */ }

    this.activeProviders.delete(key);
  }

  private async runProviderStream(
    requestId: string,
    provider: BaseProvider,
    model: string,
    messages: Message[],
    callbacks: StreamCallbacks,
    options: ChatOptions,
  ): Promise<void> {
    this.activeProviders.set(requestId, provider);
    let terminal = false;
    const release = () => {
      if (terminal) return;
      terminal = true;
      if (this.activeProviders.get(requestId) === provider) {
        this.activeProviders.delete(requestId);
      }
    };
    const wrappedCallbacks: StreamCallbacks = {
      ...callbacks,
      onComplete: () => {
        release();
        callbacks.onComplete?.();
      },
      onError: (error) => {
        release();
        callbacks.onError?.(error);
      },
    };
    try {
      await provider.chatStream(model, messages as any, wrappedCallbacks, options);
    } catch (error) {
      release();
      throw error;
    }
  }

  /**
   * 统一流式聊天接口，仅通过 ProviderRegistry 调度。
   */
  async streamChat(
    provider: string,
    model: string,
    messages: Message[],
    callbacks: StreamCallbacks,
    options: ChatOptions = {}
  ): Promise<void> {
    const requestId = typeof (options as any).__requestId === 'string' && (options as any).__requestId.trim()
      ? (options as any).__requestId
      : '__legacy__';
    const useProvider = provider; // 不做魔法纠正，维持调用方选择

    const strategy = ProviderRegistry.get(useProvider);
    if (!strategy) {
      const err = new Error(`Provider '${useProvider}' 未注册`);
      callbacks.onError?.(err);
      throw err;
    }

    // 计算参数策略应用时的“有效 Provider 名称”与“生效策略”
    // 任何 Provider 只要为模型/Provider 配置了“请求策略”，就按策略视作对应的真实 Provider，
    // 以便 ParameterPolicyEngine 应用正确的参数形态。
    let policyProviderName: string = useProvider;
    let effectiveStrategy: 'openai'|'openai-responses'|'openai-compatible'|'anthropic'|'gemini'|'deepseek'|null = null;
    try {
      try {
        const { specializedStorage } = await import('@/lib/storage');
        const s = (await specializedStorage.models.getModelStrategy(useProvider, model))
          || (await specializedStorage.models.getProviderDefaultStrategy(useProvider))
          || null;
        if (s) {
          effectiveStrategy = s as any;
          policyProviderName = ((): string => {
            switch (s) {
              case 'gemini': return 'Google AI';
              case 'anthropic': return 'Anthropic';
              case 'deepseek': return 'DeepSeek';
              case 'openai': return 'OpenAI';
              case 'openai-compatible':
              default: return 'OpenAI-Compatible';
            }
          })();
        }
      } catch { /* ignore */ }

      // 应用参数策略（按 Provider/模型正则自动注入/修正）
      const refined = ParameterPolicyEngine.apply(policyProviderName, model, options || {});

      // Proxy compatibility: if history contains tool_calls / tool role but tools[] is missing,
      // some OpenAI-compatible backends will 400. Inject a safe no-op tool and force toolChoice='none'.
      try {
        const hasToolHistory = Array.isArray(messages) && messages.some((m: any) => {
          if (!m) return false;
          if (m.role === 'tool') return true;
          if (m.role === 'assistant') {
            const tc = (m as any).tool_calls;
            return Array.isArray(tc) && tc.length > 0;
          }
          return false;
        });
        const toolDefs = (refined as any)?.tools;
        const hasTools = Array.isArray(toolDefs) && toolDefs.length > 0;
        if (hasToolHistory && !hasTools) {
          const noop: ToolDefinition = {
            name: '_noop',
            description:
              'No-op tool for proxy compatibility. It does nothing and should not be called unless required by the protocol.',
            parameters: { type: 'object', properties: {}, required: [] },
          };
          (refined as any).tools = [noop];
          (refined as any).toolChoice = 'none';
          (refined as any).parallelToolCalls = false;
          (refined as any).__noopInjected = true;
        }
      } catch {
        // ignore
      }

      // 若存在"生效策略"，则在解释器层按策略委派到对应 Provider 实现，
      // 以解决自定义聚合 Provider 在注册时为 openai-compatible 的情况。
      if (effectiveStrategy) {
        // 检查原始Provider是否需要API密钥，如果不需要则跳过委派
        const { providerRepository } = await import('@/lib/provider/ProviderRepository');
        const providers = await providerRepository.getAll();
        const originalProvider = providers.find(p => p.name === useProvider);
        
        if (originalProvider && !originalProvider.requiresKey) {
          // 如果原始Provider不需要API密钥，直接使用原始Provider，不进行委派
          await this.runProviderStream(requestId, strategy, model, messages, callbacks, refined);
          return;
        }
        
        const base = (strategy as any).baseUrl;
        const display = useProvider; // 维持原 Provider 名称，便于 KeyManager 取 key
        
        // 获取原始Provider的API密钥
        let apiKey: string | undefined = undefined;
        try {
          const { KeyManager } = await import('@/lib/llm/KeyManager');
          // 先尝试获取模型级别的API密钥
          const modelKey = await KeyManager.getModelKey(display, model);
          // 如果没有模型级别的密钥，尝试获取Provider级别的密钥
          if (modelKey) {
            apiKey = modelKey;
          } else {
            const providerKey = await KeyManager.getProviderKey(display);
            apiKey = providerKey || undefined;
          }
        } catch (error) {
          console.warn(`Failed to get API key for ${display}:`, error);
        }
        
        let delegate: BaseProvider;
        switch (effectiveStrategy) {
          case 'gemini': delegate = new GoogleAIProvider(base, apiKey); (delegate as any).aliasProviderName = display; break;
          case 'anthropic': delegate = new AnthropicProvider(base, apiKey); (delegate as any).aliasProviderName = display; break;
          case 'deepseek': delegate = new DeepSeekProvider(base, apiKey); (delegate as any).aliasProviderName = display; break;
          case 'openai': delegate = new OpenAIProvider(base, apiKey, display); (delegate as any).aliasProviderName = display; break;
          case 'openai-compatible': default: delegate = new OpenAICompatibleProvider(base, apiKey, display); (delegate as any).aliasProviderName = display; break;
        }
        await this.runProviderStream(requestId, delegate, model, messages, callbacks, refined);
        return;
      }

      // 默认：使用原始 Provider
      await this.runProviderStream(requestId, strategy, model, messages, callbacks, refined);
    } catch (e: any) {
      const strategyLabel = effectiveStrategy ? (effectiveStrategy as string) : '(未设置)';
      const extra = `模型: ${model} · Provider: ${provider} · 策略: ${strategyLabel}`;
      const msg = (e && typeof e.message === 'string') ? e.message : String(e);
      const merged = msg.includes(extra) ? msg : `${msg}\n${extra}`;
      const err = new Error(merged);
      try {
        const orig: any = e;
        if (orig && orig.code) Object.assign(err, { code: orig.code });
      } catch { /* noop */ }
      callbacks.onError?.(err);
      throw err;
    }
  }
}

// 保持旧默认实例导出（部分代码可能直接使用）
export const llmInterpreter = new LLMInterpreter();
