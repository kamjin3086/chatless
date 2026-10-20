/**
 * Provider字段支持配置与适配器
 *
 * One table answers both questions the parameter dialogs and the request path ask: which
 * fields a provider accepts, and what each one is called on the wire.
 *
 * A provider row is written one field at a time - `minP: 'min_p'` - and nothing else:
 * presence is the "supported" answer, the value is the wire spelling. `support` (which
 * dialog controls exist) and `fieldMapping` (generic name -> different wire name) are
 * derived from those rows, so adding a field is one row and the two answers cannot
 * disagree. `null` marks a field the provider accepts but does not carry under a single
 * key (the thinking carrier; Gemini streams by endpoint), which is the provider file's
 * shape to keep.
 *
 * Looking a provider up goes through `resolveProviderConfig`, which normalizes the label
 * the app shows ('Google AI') to the row key ('google-ai') and reports whether a row
 * answered or the documented default did. Callers that need the fallback to be visible
 * read `source` / `row` instead of inferring it from an object shape.
 *
 * What this table governs today: the two parameter dialogs and the drift test. The
 * request path still re-derives the same names per provider; #142's second child (#177)
 * is what makes the request path read this table. Until then, reading this as the map of
 * outgoing requests is a wrong map. Do not add a third local answer here.
 */

/**
 * Provider字段支持定义
 */
export interface ProviderFieldSupport {
  // 基础参数
  temperature?: boolean;
  maxTokens?: boolean;
  topP?: boolean;
  topK?: boolean;
  minP?: boolean;
  frequencyPenalty?: boolean;
  presencePenalty?: boolean;
  stopSequences?: boolean;

  // 扩展参数
  thinking?: boolean; // Ollama等支持thinking模式
  streaming?: boolean; // 大多数支持流式响应
  format?: boolean; // Ollama支持format参数
}

/** Names the request path passes to a provider; the table's row keys. */
export type ProviderFieldName =
  | 'temperature'
  | 'maxTokens'
  | 'topP'
  | 'topK'
  | 'minP'
  | 'frequencyPenalty'
  | 'presencePenalty'
  | 'stop'
  | 'thinking'
  | 'streaming'
  | 'format';

/**
 * A field's wire spelling. `null` means "accepted, but the provider file carries it in a
 * shape a flat key cannot express" (Anthropic's thinking object, Gemini's stream mode).
 */
export type ProviderFieldWire = string | null;

/** One row per accepted field: generic name -> wire name. */
export type ProviderFieldRows = Partial<
  Record<ProviderFieldName, ProviderFieldWire>
>;

/**
 * Provider完整配置（支持+映射+转换）
 */
export interface ProviderConfig {
  /** The rows this configuration was defined from. */
  fields: ProviderFieldRows;

  /** 支持的字段 - derived from `fields`. */
  support: ProviderFieldSupport;

  /** 字段名称映射：通用名 -> Provider特定名 - derived from `fields`. */
  fieldMapping: Record<string, string>;

  /** 特殊字段转换规则 */
  transformers?: Record<
    string,
    (value: any, allOpts: Record<string, any>) => any
  >;
}

/**
 * Which dialog control a row feeds. `stop` feeds the `stopSequences` control; every other
 * field feeds the control of its own name.
 */
const SUPPORT_KEY_BY_FIELD: Record<
  ProviderFieldName,
  keyof ProviderFieldSupport
> = {
  temperature: 'temperature',
  maxTokens: 'maxTokens',
  topP: 'topP',
  topK: 'topK',
  minP: 'minP',
  frequencyPenalty: 'frequencyPenalty',
  presencePenalty: 'presencePenalty',
  stop: 'stopSequences',
  thinking: 'thinking',
  streaming: 'streaming',
  format: 'format',
};

/**
 * Other names the request path may pass for a row. They are derived too, so a provider
 * that supports `maxTokens` does not need a second hand-written entry for
 * `maxOutputTokens`.
 */
const FIELD_ALIASES: Partial<Record<ProviderFieldName, readonly string[]>> = {
  maxTokens: ['maxOutputTokens'],
  stop: ['stopSequences'],
};

function defineProvider(
  fields: ProviderFieldRows,
  transformers?: ProviderConfig['transformers'],
): ProviderConfig {
  const support: ProviderFieldSupport = {};
  const fieldMapping: Record<string, string> = {};

  for (const [field, wire] of Object.entries(fields) as [
    ProviderFieldName,
    ProviderFieldWire,
  ][]) {
    support[SUPPORT_KEY_BY_FIELD[field]] = true;
    if (wire === null) continue;

    // Identity mappings are not renames: the request path already uses that name.
    if (wire !== field) fieldMapping[field] = wire;
    for (const alias of FIELD_ALIASES[field] ?? []) {
      if (wire !== alias) fieldMapping[alias] = wire;
    }
  }

  return { fields, support, fieldMapping, transformers };
}

/**
 * 各Provider的完整配置（支持字段 + 字段映射 + 转换规则）
 */
export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  // Ollama - 支持最全面，使用snake_case
  ollama: defineProvider({
    temperature: 'temperature',
    maxTokens: 'num_predict',
    topP: 'top_p',
    topK: 'top_k',
    minP: 'min_p',
    frequencyPenalty: 'frequency_penalty',
    presencePenalty: 'presence_penalty',
    stop: 'stop',
    // Ollama's boolean `think` and the top-level `format` are body shapes, not a
    // generic parameter name; `null` keeps the support answer without pretending the
    // wire key is `thinking`.
    thinking: null,
    streaming: 'stream',
    format: 'format',
  }),

  // OpenAI - 标准OpenAI API，使用snake_case
  openai: defineProvider({
    temperature: 'temperature',
    maxTokens: 'max_tokens',
    topP: 'top_p',
    frequencyPenalty: 'frequency_penalty',
    presencePenalty: 'presence_penalty',
    stop: 'stop',
    streaming: 'stream',
  }),

  // Google AI - 使用generationConfig嵌套结构
  'google-ai': defineProvider({
    temperature: 'temperature',
    maxTokens: 'maxOutputTokens',
    topP: 'topP',
    topK: 'topK',
    // Gemini's generationConfig takes minP and the provider already passes it through;
    // naming it here is what makes the dialog offer the control instead of hiding an
    // option the provider has always supported.
    minP: 'minP',
    stop: 'stopSequences',
    // Streaming is the endpoint (`:streamGenerateContent`), not a body field.
    streaming: null,
  }),

  // Anthropic - 使用snake_case
  anthropic: defineProvider({
    temperature: 'temperature',
    maxTokens: 'max_tokens',
    topP: 'top_p',
    topK: 'top_k',
    stop: 'stop_sequences',
    streaming: 'stream',
  }),

  // OpenAI Responses - /responses endpoint: its own token field, and it has no
  // chat-style penalties or stop sequences.
  'openai-responses': defineProvider({
    temperature: 'temperature',
    maxTokens: 'max_output_tokens',
    topP: 'top_p',
    streaming: 'stream',
  }),

  // DeepSeek - 类OpenAI，使用snake_case
  deepseek: defineProvider({
    temperature: 'temperature',
    maxTokens: 'max_tokens',
    topP: 'top_p',
    frequencyPenalty: 'frequency_penalty',
    presencePenalty: 'presence_penalty',
    stop: 'stop',
    streaming: 'stream',
  }),
};

/**
 * The documented default: an endpoint without a row is assumed to speak the OpenAI chat
 * protocol, because that is what "OpenAI-compatible" means in this app and what the old
 * inline fallback encoded. It deliberately *is* the `openai` row, so there is one answer
 * rather than a copy that drifts.
 */
export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = PROVIDER_CONFIGS.openai;

/**
 * The label the app shows -> the row key. 'Google AI' -> 'google-ai', 'OpenAI / Azure'
 * -> 'openai-azure'. Punctuation runs collapse to one dash and the edges are trimmed, so
 * a display name cannot miss its row over a space or a slash.
 */
export function normalizeProviderName(providerName: string): string {
  return providerName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export type ProviderLookupSource = 'exact' | 'contains' | 'default';

export interface ProviderResolution {
  /** The normalized lookup key. */
  name: string;
  /** The row that answered; `null` when the documented default answered. */
  row: string | null;
  /** How it was found. `default` is the visible "nothing claims this name" answer. */
  source: ProviderLookupSource;
  config: ProviderConfig;
}

/**
 * 获取Provider完整配置，并说明是哪一行（或默认行）回答的。
 *
 * A label/row mismatch is not an error - the UI passes labels while rows are keyed with
 * the API's spelling - but it must be observable: `source: 'default'` says no row claimed
 * this provider, instead of an object shape quietly standing in for an answer.
 */
export function resolveProviderConfig(
  providerName: string,
): ProviderResolution {
  const name = normalizeProviderName(providerName);

  // 尝试精确匹配
  if (name && PROVIDER_CONFIGS[name]) {
    return { name, row: name, source: 'exact', config: PROVIDER_CONFIGS[name] };
  }

  // 尝试包含匹配（如 "openai-compatible"）。The guard keeps an empty label from
  // matching the first row through `key.includes('')`.
  if (name) {
    for (const [row, config] of Object.entries(PROVIDER_CONFIGS)) {
      if (name.includes(row) || row.includes(name)) {
        return { name, row, source: 'contains', config };
      }
    }
  }

  return {
    name,
    row: null,
    source: 'default',
    config: DEFAULT_PROVIDER_CONFIG,
  };
}

/**
 * 获取Provider完整配置
 */
export function getProviderConfig(providerName: string): ProviderConfig {
  return resolveProviderConfig(providerName).config;
}

/**
 * 获取Provider支持的字段配置（兼容旧接口）
 * @deprecated Use `resolveProviderConfig(name).config.support` so the row that answered
 * is visible; this wrapper hides the fallback.
 */
export function getProviderFieldSupport(
  providerName: string,
): ProviderFieldSupport {
  return getProviderConfig(providerName).support;
}

/**
 * Provider字段适配器 - 核心适配函数
 *
 * 功能：
 * 1. 过滤不支持的字段
 * 2. 映射字段名称（通用名 -> Provider特定名）
 * 3. 应用特殊转换规则
 *
 * @deprecated The dialogs and (after #177) the request path read the table directly;
 * grep finds no caller outside this file.
 *
 * @param providerName Provider名称
 * @param options 通用选项对象
 * @returns 适配后的Provider特定选项对象
 */
export function adaptFieldsForProvider(
  providerName: string,
  options: Record<string, any>,
): Record<string, any> {
  const config = getProviderConfig(providerName);
  const result: Record<string, any> = {};

  // 字段映射（通用字段名 -> 支持配置key）
  const supportKeyMapping: Record<string, keyof ProviderFieldSupport> = {
    temperature: 'temperature',
    maxTokens: 'maxTokens',
    maxOutputTokens: 'maxTokens',
    topP: 'topP',
    topK: 'topK',
    minP: 'minP',
    frequencyPenalty: 'frequencyPenalty',
    presencePenalty: 'presencePenalty',
    stop: 'stopSequences',
    stopSequences: 'stopSequences',
    thinking: 'thinking',
    streaming: 'streaming',
    format: 'format',
  };

  // 遍历所有选项
  for (const [key, value] of Object.entries(options)) {
    // 跳过内部/扩展字段
    if (key === 'extensions' || key === 'mcpServers') {
      continue;
    }

    const supportKey = supportKeyMapping[key];

    // 检查是否支持
    if (supportKey && !config.support[supportKey]) {
      console.log(
        `[ProviderFieldAdapter] 过滤不支持的字段: ${key} (Provider: ${providerName})`,
      );
      continue;
    }

    // 映射字段名
    const targetKey = config.fieldMapping?.[key] || key;

    // 应用转换器（如果有）
    let targetValue = value;
    const transformer = config.transformers?.[key];
    if (transformer) {
      try {
        targetValue = transformer(value, options);
      } catch (error) {
        console.warn(`[ProviderFieldAdapter] 字段转换失败: ${key}`, error);
        targetValue = value; // 降级使用原值
      }
    }

    result[targetKey] = targetValue;
  }

  return result;
}

/**
 * 过滤不支持的字段（简化版，不做字段映射）
 * @deprecated 使用 adaptFieldsForProvider 替代，获得完整的适配功能
 */
export function filterUnsupportedFields(
  providerName: string,
  options: Record<string, any>,
): Record<string, any> {
  const support = getProviderFieldSupport(providerName);
  const filtered: Record<string, any> = {};

  // 字段映射（参数名 -> 支持配置key）
  const fieldMapping: Record<string, keyof ProviderFieldSupport> = {
    temperature: 'temperature',
    maxTokens: 'maxTokens',
    topP: 'topP',
    topK: 'topK',
    minP: 'minP',
    frequencyPenalty: 'frequencyPenalty',
    presencePenalty: 'presencePenalty',
    stop: 'stopSequences',
    thinking: 'thinking',
    streaming: 'streaming',
    format: 'format',
  };

  // 遍历所有选项
  for (const [key, value] of Object.entries(options)) {
    const supportKey = fieldMapping[key];

    // 如果字段在映射中且不被支持，则跳过
    if (supportKey && !support[supportKey]) {
      console.log(
        `[ProviderFieldSupport] 过滤不支持的字段: ${key} (Provider: ${providerName})`,
      );
      continue;
    }

    // 保留字段
    filtered[key] = value;
  }

  return filtered;
}

/**
 * 兼容性：保留旧的PROVIDER_FIELD_SUPPORT导出
 * @deprecated 使用 PROVIDER_CONFIGS 替代
 */
export const PROVIDER_FIELD_SUPPORT: Record<string, ProviderFieldSupport> =
  Object.fromEntries(
    Object.entries(PROVIDER_CONFIGS).map(([key, config]) => [
      key,
      config.support,
    ]),
  );
