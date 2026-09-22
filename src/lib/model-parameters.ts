import { specializedStorage } from './storage';
import { DEFAULT_MODEL_PARAMETERS } from '@/types/model-params';
import type { ModelParameters } from '@/types/model-params';
import { adaptFieldsForProvider } from './llm/provider-field-support';
import { resolveOutputBudget } from './llm/outputBudget';

export class ModelParametersService {
  /**
   * 获取指定模型的参数配置
   */
  static async getModelParameters(providerName: string, modelId: string): Promise<ModelParameters> {
    try {
      const savedParams = await specializedStorage.models.getModelParameters(providerName, modelId);
      if (savedParams) {
        return savedParams as ModelParameters;
      }
      return DEFAULT_MODEL_PARAMETERS;
    } catch (error) {
      console.error('获取模型参数失败:', error);
      return DEFAULT_MODEL_PARAMETERS;
    }
  }

  /**
   * 保存模型参数配置
   */
  static async setModelParameters(
    providerName: string, 
    modelId: string, 
    parameters: ModelParameters
  ): Promise<void> {
    try {
      await specializedStorage.models.setModelParameters(providerName, modelId, parameters);
    } catch (error) {
      console.error('保存模型参数失败:', error);
      throw error;
    }
  }

  /**
   * 删除模型参数配置
   */
  static async removeModelParameters(providerName: string, modelId: string): Promise<void> {
    try {
      await specializedStorage.models.removeModelParameters(providerName, modelId);
    } catch (error) {
      console.error('删除模型参数失败:', error);
      throw error;
    }
  }

  /**
   * Records a context window discovered from the provider's model list.
   *
   * Only fills a gap: a value the user typed is never overwritten, and a model
   * that already knows its window is left alone. This is what makes the output
   * budget work on the next launch without the user opening a dialog.
   */
  static async setContextWindowIfUnset(
    providerName: string,
    modelId: string,
    contextWindow: number,
  ): Promise<boolean> {
    const window = Math.floor(Number(contextWindow));
    if (!Number.isFinite(window) || window <= 0) return false;
    try {
      const saved = await ModelParametersService.getModelParameters(providerName, modelId);
      if (typeof saved.contextWindow === 'number' && saved.contextWindow > 0) return false;
      await ModelParametersService.setModelParameters(providerName, modelId, { ...saved, contextWindow: window });
      return true;
    } catch (error) {
      console.warn('[ModelParameters] 记录上下文窗口失败:', error);
      return false;
    }
  }

  /**
   * 获取所有模型参数配置的键
   */
  static async getAllModelParameterKeys(): Promise<string[]> {
    try {
      return await specializedStorage.models.getAllModelParameters();
    } catch (error) {
      console.error('获取所有模型参数键失败:', error);
      return [];
    }
  }

  /**
   * 将模型参数转换为聊天选项格式
   */
  static convertToChatOptions(parameters: ModelParameters): Record<string, any> {
    // 仅当用户"启用"某参数或者值与默认不同，才传给 Provider
    const opts: Record<string, any> = { ...(parameters.advancedOptions || {}) };
    const def = DEFAULT_MODEL_PARAMETERS;

    const shouldSet = (enabledFlag: boolean | undefined, value: any, defValue: any) => {
      // 若显式关闭则不传；若与默认相同且未显式开启也不传
      if (enabledFlag === false) return false;
      if (enabledFlag === true) return true;
      return value !== defValue;
    };

    if (shouldSet(parameters.enableTemperature, parameters.temperature, def.temperature)) {
      opts.temperature = parameters.temperature;
    }
    if (shouldSet(parameters.enableMaxTokens, parameters.maxTokens, def.maxTokens)) {
      opts.maxTokens = parameters.maxTokens;
    }
    if (shouldSet(parameters.enableTopP, parameters.topP, def.topP)) {
      opts.topP = parameters.topP;
    }
    if (shouldSet((parameters as any).enableTopK, (parameters as any).topK, (def as any).topK)) {
      (opts as any).topK = (parameters as any).topK;
    }
    if (shouldSet((parameters as any).enableMinP, (parameters as any).minP, (def as any).minP)) {
      (opts as any).minP = (parameters as any).minP;
    }
    if (shouldSet(parameters.enableFrequencyPenalty, parameters.frequencyPenalty, def.frequencyPenalty)) {
      opts.frequencyPenalty = parameters.frequencyPenalty;
    }
    if (shouldSet(parameters.enablePresencePenalty, parameters.presencePenalty, def.presencePenalty)) {
      opts.presencePenalty = parameters.presencePenalty;
    }
    if (shouldSet(parameters.enableStopSequences, parameters.stopSequences.length, 0)) {
      if (parameters.stopSequences.length > 0) {
        opts.stop = parameters.stopSequences;
      }
    }
    
    // 处理思考和流式响应参数
    if (shouldSet(parameters.enableThinking, parameters.thinking, def.thinking)) {
      opts.thinking = parameters.thinking;
    }
    if (shouldSet(parameters.enableStreaming, parameters.streaming, def.streaming)) {
      opts.streaming = parameters.streaming;
    }
    
    return opts;
  }

  /**
   * Applies the resolved output budget to a chat-options object.
   *
   * A user value wins (clamped to the window). Otherwise the default applies
   * only when the window is known; an unknown window sends nothing and keeps
   * today's behaviour of letting the server decide. The window also travels in
   * `contextWindowTokens` so the context manager reserves the same amount.
   */
  static applyOutputBudget(
    options: Record<string, any>,
    params: { contextWindow?: number },
  ): Record<string, any> {
    const next = { ...options };
    const window = Number(params?.contextWindow);
    const known = Number.isFinite(window) && window > 0 ? Math.floor(window) : undefined;

    const budget = resolveOutputBudget({
      contextWindow: known,
      userMaxTokens: typeof options.maxTokens === 'number' ? options.maxTokens : undefined,
    });
    if (typeof budget === 'number') next.maxTokens = budget;
    else delete next.maxTokens;

    if (known) next.contextWindowTokens = known;
    else delete next.contextWindowTokens;
    return next;
  }

  /**
   * 反向解析：将通用 ChatOptions 拆解回 ModelParameters 结构（基础参数 + 高级参数）
   * - 会尽量从顶层或 generationConfig 中提取基础参数
   * - 其余参数保留在 advancedOptions 中，且会移除与基础参数重复的字段
   */
  static parseFromChatOptions(options: Record<string, any> | null | undefined): ModelParameters {
    const src: any = options || {};
    const gen: any = (src.generationConfig && typeof src.generationConfig === 'object') ? src.generationConfig : {};

    const temperature: number =
      (typeof src.temperature === 'number' ? src.temperature :
        (typeof gen.temperature === 'number' ? gen.temperature : DEFAULT_MODEL_PARAMETERS.temperature));

    const maxTokens: number =
      (typeof src.maxTokens === 'number' ? src.maxTokens :
        (typeof src.maxOutputTokens === 'number' ? src.maxOutputTokens :
          (typeof gen.maxOutputTokens === 'number' ? gen.maxOutputTokens : DEFAULT_MODEL_PARAMETERS.maxTokens)));

    // The context window is a capability we track, never a request field.
    const contextWindow: number | undefined =
      (typeof src.contextWindow === 'number' ? src.contextWindow :
        (typeof gen.contextWindow === 'number' ? gen.contextWindow : undefined));

    const topP: number =
      (typeof src.topP === 'number' ? src.topP :
        (typeof gen.topP === 'number' ? gen.topP : DEFAULT_MODEL_PARAMETERS.topP));

    const topK: number =
      (typeof src.topK === 'number' ? src.topK :
        (typeof gen.topK === 'number' ? gen.topK : (DEFAULT_MODEL_PARAMETERS as any).topK || 0));

    const minP: number =
      (typeof src.minP === 'number' ? src.minP :
        (typeof gen.minP === 'number' ? gen.minP : (DEFAULT_MODEL_PARAMETERS as any).minP || 0));

    const frequencyPenalty: number =
      (typeof src.frequencyPenalty === 'number' ? src.frequencyPenalty : DEFAULT_MODEL_PARAMETERS.frequencyPenalty);

    const presencePenalty: number =
      (typeof src.presencePenalty === 'number' ? src.presencePenalty : DEFAULT_MODEL_PARAMETERS.presencePenalty);

    const stopSeq: string[] = Array.isArray(src.stop)
      ? src.stop as string[]
      : (Array.isArray(gen.stopSequences) ? gen.stopSequences as string[] : []);

    // 构造 advancedOptions：从深拷贝的对象中移除基础字段
    const advanced = JSON.parse(JSON.stringify(src || {}));
    // 移除顶层基础字段
    delete advanced.temperature;
    delete advanced.maxTokens;
    delete advanced.maxOutputTokens;
    delete advanced.contextWindow;
    delete advanced.topP;
    delete advanced.topK;
    delete advanced.minP;
    delete advanced.frequencyPenalty;
    delete advanced.presencePenalty;
    delete advanced.stop;
    // 移除 generationConfig 中与基础字段重复的项
    if (advanced.generationConfig && typeof advanced.generationConfig === 'object') {
      if (advanced.generationConfig.temperature !== undefined) delete advanced.generationConfig.temperature;
      if (advanced.generationConfig.maxOutputTokens !== undefined) delete advanced.generationConfig.maxOutputTokens;
      if (advanced.generationConfig.contextWindow !== undefined) delete advanced.generationConfig.contextWindow;
      if (advanced.generationConfig.topP !== undefined) delete advanced.generationConfig.topP;
      if (advanced.generationConfig.stopSequences !== undefined) delete advanced.generationConfig.stopSequences;
      // 如果 generationConfig 变空对象，保留（兼容后续可能新增字段），不特殊处理
    }

    return {
      temperature,
      maxTokens,
      contextWindow,
      topP,
      topK,
      minP,
      frequencyPenalty,
      presencePenalty,
      stopSequences: stopSeq,
      advancedOptions: advanced,
    } as any;
  }

  // ========== 会话参数相关方法 ==========

  /**
   * 获取指定会话的参数配置
   */
  static async getSessionParameters(conversationId: string): Promise<ModelParameters | null> {
    try {
      const savedParams = await specializedStorage.models.getSessionParameters(conversationId);
      if (savedParams) {
        return savedParams as ModelParameters;
      }
      return null;
    } catch (error) {
      console.error('获取会话参数失败:', error);
      return null;
    }
  }

  /**
   * 保存会话参数配置
   */
  static async setSessionParameters(
    conversationId: string, 
    parameters: ModelParameters
  ): Promise<void> {
    try {
      await specializedStorage.models.setSessionParameters(conversationId, parameters);
    } catch (error) {
      console.error('保存会话参数失败:', error);
      throw error;
    }
  }

  /**
   * 删除会话参数配置
   */
  static async removeSessionParameters(conversationId: string): Promise<void> {
    try {
      await specializedStorage.models.removeSessionParameters(conversationId);
    } catch (error) {
      console.error('删除会话参数失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有会话参数配置的键
   */
  static async getAllSessionParameterKeys(): Promise<string[]> {
    try {
      return await specializedStorage.models.getAllSessionParameters();
    } catch (error) {
      console.error('获取所有会话参数键失败:', error);
      return [];
    }
  }
} 
