import { migrateLegacyThinkingBoolean } from '@/lib/chat/thinkingScope';
import {
  DEFAULT_MODEL_PARAMETERS,
  MODEL_PARAMETER_LIMITS,
} from '@/types/model-params';
import type {
  ModelParameterPatch,
  ModelParameters,
} from '@/types/model-params';
import { resolveOutputBudget } from './llm/outputBudget';
import { adaptFieldsForProvider } from './llm/provider-field-support';
import { THINKING_LEVELS } from './llm/thinkingLevels';
import { specializedStorage } from './storage';

type FieldShape =
  | { kind: 'number' }
  | { kind: 'int' }
  | { kind: 'boolean' }
  | { kind: 'string' }
  | { kind: 'enum'; allowed: readonly string[] }
  | { kind: 'stringArray' }
  | { kind: 'object' };

/**
 * Every field a parameter bag may carry and what a trustworthy value looks like.
 *
 * The bag is JSON written by older versions of this app and edited by hand often enough to
 * be worth expecting the unexpected. Without this table a stored `"0.7"`, a `null` array or
 * a temperature of 99 went straight through to a request, and one of those shapes reached a
 * user as a crash (#137). A field this table does not name is a field nothing should be
 * reading either, so it is dropped rather than passed along.
 */
const PARAM_FIELDS: Record<string, FieldShape> = {
  temperature: { kind: 'number' },
  maxTokens: { kind: 'int' },
  contextWindow: { kind: 'int' },
  observedContextWindow: { kind: 'int' },
  topP: { kind: 'number' },
  topK: { kind: 'int' },
  minP: { kind: 'number' },
  frequencyPenalty: { kind: 'number' },
  presencePenalty: { kind: 'number' },
  stopSequences: { kind: 'stringArray' },
  thinking: { kind: 'boolean' },
  thinkingLevel: { kind: 'enum', allowed: THINKING_LEVELS },
  streaming: { kind: 'boolean' },
  format: { kind: 'string' },
  responseFormat: { kind: 'enum', allowed: ['none', 'json', 'schema'] },
  responseFormatSchema: { kind: 'string' },
  advancedOptions: { kind: 'object' },
  enableTemperature: { kind: 'boolean' },
  enableMaxTokens: { kind: 'boolean' },
  enableTopP: { kind: 'boolean' },
  enableTopK: { kind: 'boolean' },
  enableMinP: { kind: 'boolean' },
  enableFrequencyPenalty: { kind: 'boolean' },
  enablePresencePenalty: { kind: 'boolean' },
  enableStopSequences: { kind: 'boolean' },
  enableThinking: { kind: 'boolean' },
  enableThinkingLevel: { kind: 'boolean' },
  enableStreaming: { kind: 'boolean' },
  enableFormat: { kind: 'boolean' },
};

function cleanNumber(raw: number, key: string): number {
  const limits = (
    MODEL_PARAMETER_LIMITS as Record<string, Partial<ModelParameters>>
  )[key] as
    | { min?: number; max?: number; inputMin?: number; inputMax?: number }
    | undefined;
  const low = limits?.inputMin ?? limits?.min;
  const high = limits?.inputMax ?? limits?.max;
  let value = raw;
  if (low !== undefined && value < low) value = low;
  if (high !== undefined && value > high) value = high;
  return value;
}

function cleanValue(raw: unknown, shape: FieldShape, key: string): unknown {
  switch (shape.kind) {
    case 'number':
      return typeof raw === 'number' && Number.isFinite(raw)
        ? cleanNumber(raw, key)
        : undefined;
    case 'int':
      return typeof raw === 'number' && Number.isFinite(raw)
        ? Math.round(cleanNumber(raw, key))
        : undefined;
    case 'boolean':
      return typeof raw === 'boolean' ? raw : undefined;
    case 'string':
      return typeof raw === 'string' ? raw : undefined;
    case 'enum':
      return shape.allowed.includes(raw as string) ? raw : undefined;
    case 'stringArray':
      return Array.isArray(raw)
        ? raw.filter((x) => typeof x === 'string')
        : undefined;
    case 'object':
      return raw && typeof raw === 'object' && !Array.isArray(raw)
        ? raw
        : undefined;
  }
}

/**
 * Clean one scope's bag without completing it.
 *
 * A session that never mentioned stop sequences must keep not mentioning it: `auto` and
 * "this scope has no opinion" are carried by absence, and filling the gaps would make the
 * session appear to have chosen every model default. Untrustworthy values are dropped,
 * which is the same as never having chosen them.
 */
export function sanitizeParameterPatch(raw: unknown): ModelParameterPatch {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const patch: ModelParameterPatch = {};
  for (const [key, shape] of Object.entries(PARAM_FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = cleanValue(source[key], shape, key);
    if (value === undefined) continue;
    (patch as Record<string, unknown>)[key] = value;
  }
  return patch;
}

export class ModelParametersService {
  /**
   * 获取指定模型的参数配置
   */
  static async getModelParameters(
    providerName: string,
    modelId: string,
  ): Promise<ModelParameters> {
    const saved = await ModelParametersService.readStoredModelParameters(
      providerName,
      modelId,
    );
    if (!saved) return DEFAULT_MODEL_PARAMETERS;
    // #100 retired the boolean's entry point; what is already stored is translated here,
    // once, so the wire and every screen read the same meaning. `getRawModelParameters`
    // stays available for the one thing that must know a migration happened: the control's
    // explanation. Defaults are not migrated - they are this code's own baseline, not a
    // user's old choice.
    // Types are checked once, here, so no consumer has to re-guess what a hand-edited or
    // older store may contain. Absence is deliberately preserved: a migration that removed a
    // retired field, or a scope that never mentioned one, means something that a default
    // would erase.
    return sanitizeParameterPatch(
      migrateLegacyThinkingBoolean({
        provider: providerName,
        modelId,
        params: saved,
      }).params,
    ) as ModelParameters;
  }

  /**
   * The stored bag as written, with nothing translated - or null when there is nothing
   * stored. Null matters: `DEFAULT_MODEL_PARAMETERS` carries `enableThinkingLevel: false`,
   * which means "this bag refused a level", and handing that to a model the user never
   * configured would make the control blame the model for an absence.
   */
  static async getRawModelParameters(
    providerName: string,
    modelId: string,
  ): Promise<ModelParameters | null> {
    return ModelParametersService.readStoredModelParameters(
      providerName,
      modelId,
    );
  }

  private static async readStoredModelParameters(
    providerName: string,
    modelId: string,
  ): Promise<ModelParameters | null> {
    try {
      const savedParams = await specializedStorage.models.getModelParameters(
        providerName,
        modelId,
      );
      return savedParams ? (savedParams as ModelParameters) : null;
    } catch (error) {
      console.error('获取模型参数失败:', error);
      return null;
    }
  }

  /**
   * 保存模型参数配置
   */
  static async setModelParameters(
    providerName: string,
    modelId: string,
    parameters: ModelParameters,
  ): Promise<void> {
    try {
      await specializedStorage.models.setModelParameters(
        providerName,
        modelId,
        parameters,
      );
    } catch (error) {
      console.error('保存模型参数失败:', error);
      throw error;
    }
  }

  /**
   * 删除模型参数配置
   */
  static async removeModelParameters(
    providerName: string,
    modelId: string,
  ): Promise<void> {
    try {
      await specializedStorage.models.removeModelParameters(
        providerName,
        modelId,
      );
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
      const saved = await ModelParametersService.getModelParameters(
        providerName,
        modelId,
      );
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
    params:
      | { contextWindow?: number; observedContextWindow?: number }
      | null
      | undefined,
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
    session?: ModelParameterPatch | null,
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
  static convertToChatOptions(input: ModelParameterPatch): Record<string, any> {
    // A conversation or a message hands this a patch - only what the user touched - so it
    // is cleaned here rather than trusted. Absence is preserved on purpose; a wrong type is
    // dropped as if the value had never been chosen.
    const parameters: ModelParameters = sanitizeParameterPatch(
      input,
    ) as ModelParameters;
    // 仅当用户"启用"某参数或者值与默认不同，才传给 Provider
    const opts: Record<string, any> = { ...(parameters.advancedOptions || {}) };
    const def = DEFAULT_MODEL_PARAMETERS;

    const shouldSet = (
      enabledFlag: boolean | undefined,
      value: any,
      defValue: any,
    ) => {
      // 若显式关闭则不传；若与默认相同且未显式开启也不传
      if (enabledFlag === false) return false;
      if (enabledFlag === true) return true;
      return value !== defValue;
    };

    if (
      shouldSet(
        parameters.enableTemperature,
        parameters.temperature,
        def.temperature,
      )
    ) {
      opts.temperature = parameters.temperature;
    }
    if (
      shouldSet(parameters.enableMaxTokens, parameters.maxTokens, def.maxTokens)
    ) {
      opts.maxTokens = parameters.maxTokens;
    }
    if (shouldSet(parameters.enableTopP, parameters.topP, def.topP)) {
      opts.topP = parameters.topP;
    }
    if (
      shouldSet(
        (parameters as any).enableTopK,
        (parameters as any).topK,
        (def as any).topK,
      )
    ) {
      (opts as any).topK = (parameters as any).topK;
    }
    if (
      shouldSet(
        (parameters as any).enableMinP,
        (parameters as any).minP,
        (def as any).minP,
      )
    ) {
      (opts as any).minP = (parameters as any).minP;
    }
    if (
      shouldSet(
        parameters.enableFrequencyPenalty,
        parameters.frequencyPenalty,
        def.frequencyPenalty,
      )
    ) {
      opts.frequencyPenalty = parameters.frequencyPenalty;
    }
    if (
      shouldSet(
        parameters.enablePresencePenalty,
        parameters.presencePenalty,
        def.presencePenalty,
      )
    ) {
      opts.presencePenalty = parameters.presencePenalty;
    }
    // `stopSequences` lives in the stored bag, not in the type: a session bag written by a
    // partial save simply does not have the key, and this read `.length` off the missing
    // value before the enabled flag was even consulted - so a chat that had never opened the
    // parameters dialog threw on every send once a session bag appeared for it.
    const stopSequences = Array.isArray(parameters.stopSequences)
      ? parameters.stopSequences
      : [];
    if (shouldSet(parameters.enableStopSequences, stopSequences.length, 0)) {
      if (stopSequences.length > 0) {
        opts.stop = stopSequences;
      }
    }

    // 处理思考和流式响应参数
    if (
      shouldSet(parameters.enableThinking, parameters.thinking, def.thinking)
    ) {
      opts.thinking = parameters.thinking;
    }
    // A level is sent only when explicitly enabled and not `auto`, so a model that
    // never touched the control sends exactly what it always sent.
    if (
      parameters.enableThinkingLevel === true &&
      parameters.thinkingLevel &&
      parameters.thinkingLevel !== 'auto'
    ) {
      opts.thinkingLevel = parameters.thinkingLevel;
    }
    if (
      shouldSet(parameters.enableStreaming, parameters.streaming, def.streaming)
    ) {
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
    params: {
      contextWindow?: number;
      observedContextWindow?: number;
      enableMaxTokens?: boolean;
    },
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
        userMaxTokens:
          typeof options.maxTokens === 'number' ? options.maxTokens : undefined,
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
  static parseFromChatOptions(
    options: Record<string, any> | null | undefined,
  ): ModelParameters {
    const src: any = options || {};
    const gen: any =
      src.generationConfig && typeof src.generationConfig === 'object'
        ? src.generationConfig
        : {};

    const temperature: number =
      typeof src.temperature === 'number'
        ? src.temperature
        : typeof gen.temperature === 'number'
          ? gen.temperature
          : DEFAULT_MODEL_PARAMETERS.temperature;

    const maxTokens: number =
      typeof src.maxTokens === 'number'
        ? src.maxTokens
        : typeof src.maxOutputTokens === 'number'
          ? src.maxOutputTokens
          : typeof gen.maxOutputTokens === 'number'
            ? gen.maxOutputTokens
            : DEFAULT_MODEL_PARAMETERS.maxTokens;

    // The context window is a capability we track, never a request field.
    const contextWindow: number | undefined =
      typeof src.contextWindow === 'number'
        ? src.contextWindow
        : typeof gen.contextWindow === 'number'
          ? gen.contextWindow
          : undefined;

    const topP: number =
      typeof src.topP === 'number'
        ? src.topP
        : typeof gen.topP === 'number'
          ? gen.topP
          : DEFAULT_MODEL_PARAMETERS.topP;

    const topK: number =
      typeof src.topK === 'number'
        ? src.topK
        : typeof gen.topK === 'number'
          ? gen.topK
          : (DEFAULT_MODEL_PARAMETERS as any).topK || 0;

    const minP: number =
      typeof src.minP === 'number'
        ? src.minP
        : typeof gen.minP === 'number'
          ? gen.minP
          : (DEFAULT_MODEL_PARAMETERS as any).minP || 0;

    const frequencyPenalty: number =
      typeof src.frequencyPenalty === 'number'
        ? src.frequencyPenalty
        : DEFAULT_MODEL_PARAMETERS.frequencyPenalty;

    const presencePenalty: number =
      typeof src.presencePenalty === 'number'
        ? src.presencePenalty
        : DEFAULT_MODEL_PARAMETERS.presencePenalty;

    const stopSeq: string[] = Array.isArray(src.stop)
      ? (src.stop as string[])
      : Array.isArray(gen.stopSequences)
        ? (gen.stopSequences as string[])
        : [];

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
    if (
      advanced.generationConfig &&
      typeof advanced.generationConfig === 'object'
    ) {
      if (advanced.generationConfig.temperature !== undefined)
        delete advanced.generationConfig.temperature;
      if (advanced.generationConfig.maxOutputTokens !== undefined)
        delete advanced.generationConfig.maxOutputTokens;
      if (advanced.generationConfig.contextWindow !== undefined)
        delete advanced.generationConfig.contextWindow;
      if (advanced.generationConfig.topP !== undefined)
        delete advanced.generationConfig.topP;
      if (advanced.generationConfig.stopSequences !== undefined)
        delete advanced.generationConfig.stopSequences;
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
  static async getSessionParameters(
    conversationId: string,
  ): Promise<ModelParameters | null> {
    try {
      const savedParams =
        await specializedStorage.models.getSessionParameters(conversationId);
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
    parameters: ModelParameters,
  ): Promise<void> {
    try {
      await specializedStorage.models.setSessionParameters(
        conversationId,
        parameters,
      );
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
