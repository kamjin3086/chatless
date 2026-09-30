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
   * Records a context window reported by the provider's model list.
   *
   * It is stored separately from the user's own value so neither side has to win
   * outright: the effective window is the smaller of the two, and a provider that
   * later shrinks its window cannot be masked by a stale larger number.
   */
  static async recordObservedContextWindow(
    providerName: string,
    modelId: string,
    contextWindow: number,
  ): Promise<boolean> {
    const window = Math.floor(Number(contextWindow));
    if (!Number.isFinite(window) || window <= 0) return false;
    try {
      const saved = await ModelParametersService.getModelParameters(providerName, modelId);
      if (saved.observedContextWindow === window) return false;
      await ModelParametersService.setModelParameters(providerName, modelId, {
        ...saved,
        observedContextWindow: window,
      });
      return true;
    } catch (error) {
      console.warn('[ModelParameters] 记录服务商上报的上下文窗口失败:', error);
      return false;
    }
  }

  /**
   * 实际生效的上下文窗口：用户填写与服务商上报取较小值。
   * 只有两边都没有时才算未知（未知 = 不下发 max_tokens）。
   */
  static effectiveContextWindow(
    params: { contextWindow?: number; observedContextWindow?: number } | null | undefined,
  ): number | undefined {
    const toPositive = (value: unknown) => {
      const parsed = Math.floor(Number(value));
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    };
    const user = toPositive(params?.contextWindow);
    const observed = toPositive(params?.observedContextWindow);
    if (user && observed) return Math.min(user, observed);
    return user ?? observed;
  }

  /**
   * 会话参数只覆盖"要不要下发输出上限"，窗口始终来自模型本身。
   */
  static resolveBudgetParameters(
    model: ModelParameters,
    session?: ModelParameters | null,
  ): ModelParameters {
    if (!session) return model;
    return {
      ...model,
      enableMaxTokens: session.enableMaxTokens ?? model.enableMaxTokens,
      contextWindow: session.contextWindow ?? model.contextWindow,
    };
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
   * 唯一的下发上限判定点。
   *
   * - `enableMaxTokens === false` → 关闭，不下发；
   * - `options.maxTokens` 有值（手动启用或会话覆盖）→ 按有效窗口收敛后下发；
   * - 否则 → 自动：**不下发**，由服务端决定单次能输出多久。
   *
   * 有效窗口同时写进 `contextWindowTokens`，供上下文管理器判断是否需要压缩历史。
   */
  static applyOutputBudget(
    options: Record<string, any>,
    params: { contextWindow?: number; observedContextWindow?: number; enableMaxTokens?: boolean },
  ): Record<string, any> {
    const next = { ...options };
    const window = ModelParametersService.effectiveContextWindow(params);

    // 关闭：不管别处填了什么，都不下发。
    if (params?.enableMaxTokens === false) {
      delete next.maxTokens;
    } else {
      // options 里存在 maxTokens 只可能来自"手动启用"或会话覆盖（convertToChatOptions
      // 在自动模式下不下发），所以这里能区分自动与手动。自动模式交给服务端。
      const budget = resolveOutputBudget({
        contextWindow: window,
        userMaxTokens: typeof options.maxTokens === 'number' ? options.maxTokens : undefined,
      });
      if (typeof budget === 'number') next.maxTokens = budget;
      else delete next.maxTokens;
    }

    if (window) next.contextWindowTokens = window;
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
