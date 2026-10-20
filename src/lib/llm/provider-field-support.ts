/**
 * Provider field support: one table for the parameter dialogs and, after #177, the
 * request path.
 *
 * A provider row is written one field at a time - `minP: 'min_p'` - and nothing else:
 * presence is the "supported" answer, the value is the wire spelling. `support` (which
 * dialog controls exist) and `fieldMapping` (generic/alias name -> wire name, identity
 * entries included) are derived from those rows, so adding a field is one row and the two
 * answers cannot disagree. `null` marks a field the provider accepts but does not carry
 * under a single key (the thinking carrier; Gemini streams by endpoint), which is the
 * provider file's shape to keep.
 *
 * Looking a provider up goes through `resolveProviderConfig`, which normalizes the label
 * the app shows ('Google AI') to the row key ('google-ai') and reports whether a row
 * answered or the documented default did. Callers that need the fallback to be visible
 * read `source` / `row` instead of inferring it from an object shape.
 *
 * What this table governs today: the two parameter dialogs and the drift test. The
 * request path still re-derives the same names per provider (`grep -rn PROVIDER_CONFIGS
 * src/lib/llm/providers` finds nothing today); #177 is what makes the request path read
 * this table. Until then, reading this as the map of outgoing requests is a wrong map.
 * Keep one answer in this file.
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
 * Provider完整配置（支持 + 映射）
 */
export interface ProviderConfig {
  /** The rows this configuration was defined from. */
  fields: ProviderFieldRows;

  /** 支持的字段 - derived from `fields`. */
  support: ProviderFieldSupport;

  /** Generic/alias name -> wire name - derived from `fields`, identities included. */
  fieldMapping: Record<string, string>;
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

function defineProvider(fields: ProviderFieldRows): ProviderConfig {
  const support: ProviderFieldSupport = {};
  const fieldMapping: Record<string, string> = {};

  for (const [field, wire] of Object.entries(fields) as [
    ProviderFieldName,
    ProviderFieldWire,
  ][]) {
    support[SUPPORT_KEY_BY_FIELD[field]] = true;
    if (wire === null) continue;

    // Every name a caller may pass, including the identity spelling. Keeping identity
    // entries means the wire-options drift check can see an app-side name like `format`
    // without a provider having to invent a different spelling for it.
    fieldMapping[field] = wire;
    for (const alias of FIELD_ALIASES[field] ?? []) {
      fieldMapping[alias] = wire;
    }
  }

  return { fields, support, fieldMapping };
}

/**
 * 各Provider的完整配置（支持字段 + 字段映射）
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
 * The provider's configuration, plus which row (or the default) answered.
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
