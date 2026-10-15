/**
 * Thinking levels: how much a model should think before it answers.
 *
 * The app has always been able to say *whether* a model thinks (a boolean that exists
 * for Ollama-shaped providers) but never *how much*, so the only way to change effort
 * was raw parameter JSON or a differently-named model. This module is the vocabulary
 * and the table; translating a level onto a specific provider's wire format stays one
 * rule in `ParameterPolicy`, so adding a provider means adding a row here.
 *
 * Two honesty rules this file exists to enforce:
 *   - `auto` is not a disguised default. It means "send nothing and let the model
 *     decide", which is also exactly the behaviour before levels existed.
 *   - an unmapped model is `auto (unverified)`, and it sends nothing. A level is never
 *     quietly reinterpreted as a nearby level the model may not accept.
 */

/**
 * Ordered from "let the model decide" through "think as long as you need". A value list
 * rather than a bare union so anything reading untrusted storage can ask, at runtime,
 * whether a level exists instead of keeping its own copy of the answer.
 */
export const THINKING_LEVELS = [
  'auto',
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  // Anthropic's deepest rung. Only that provider's rows offer it, so no other model
  // is ever shown a tier its API would refuse.
  'max',
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** How a level reaches a given provider. */
export type ThinkingCarrier =
  | 'reasoning_effort'
  | 'thinking_level'
  | 'thinking_budget'
  | 'ollama_think'
  | 'anthropic_effort'
  | 'anthropic_disable'
  | 'model_alias'
  | 'unsupported';

export const THINKING_LEVEL_ORDER: ThinkingLevel[] = [
  'auto',
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

/** Wire field a carrier is expressed as. Levels not in `wire` are not offered. */
const CARRIER_FIELD: Record<ThinkingCarrier, string | null> = {
  reasoning_effort: 'reasoning_effort',
  // Gemini documents both fields nested inside generationConfig.thinkingConfig, and a
  // dotted name here means exactly that path: a flat `thinking_level` would be ignored
  // by the API and the level would silently do nothing.
  thinking_level: 'generationConfig.thinkingConfig.thinkingLevel',
  thinking_budget: 'generationConfig.thinkingConfig.thinkingBudget',
  model_alias: null,
  unsupported: null,
  // Ollama's API field is `think`, but the provider already translates this repo's
  // internal `thinking` option into that body field, so the carrier aims at the option
  // that path already reads instead of inventing a second one.
  ollama_think: 'thinking',
  // Anthropic steers depth with `output_config.effort`, and says the depth of a
  // thinking *mode* is not an effort level: turning it off is `thinking.type`.
  anthropic_effort: 'output_config.effort',
  anthropic_disable: 'thinking.type',
};

/**
 * A carrier field may be a dotted path (see `CARRIER_FIELD`). Reading and writing one
 * never mutates the caller's object: the option bag is shared with the UI and with
 * stored parameters, and a rule that reached through it would leave a level applied to
 * a request the user never asked for.
 */
export function readWireField(source: unknown, field: string): unknown {
  return field
    .split('.')
    .reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), source);
}

export function withWireField<T extends Record<string, any>>(
  target: T,
  field: string,
  value: unknown,
): T {
  const keys = field.split('.');
  const branch = (value: any) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? { ...value }
      : value;
  const root: any = branch(target);
  let cursor = root;
  for (const key of keys.slice(0, -1)) {
    cursor[key] = branch(cursor[key] ?? {});
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
  return root as T;
}

export interface ThinkingMapping {
  id: string;
  description?: string;
  /**
   * Always participates in the match. A broad pattern is how a row says "any
   * OpenAI-compatible gateway"; there is deliberately no mode that ignores the
   * provider, because that is how a level would reach a server that never advertised
   * one - the exact failure this table exists to prevent.
   */
  provider: RegExp;
  model: RegExp;
  /** True for the catch-all row that stands for "some OpenAI-compatible box". */
  generic?: boolean;
  carrier: ThinkingCarrier;
  /** level -> wire value. `auto` is never mapped: it means send nothing. */
  wire?: Partial<Record<ThinkingLevel, string | number | boolean>>;
}

/**
 * Known-good rows only. A row here is a claim that this provider/model accepts these
 * levels in this field, so an unlisted model is reported as unverified rather than
 * guessed at - the same rule as everywhere else in this repo.
 */
/**
 * Gemini's two shapes are per-generation and not interchangeable: the 3 series takes a
 * `thinkingLevel` string and each model advertises a different subset, while the 2.5
 * series documents `thinkingBudget` and says outright that it does not support
 * thinkingLevel. Every number below sits inside the range the documentation gives that
 * model (2.5 Flash 0..24576, 2.5 Flash Lite 512..24576, 2.5 Pro 128..32768); the choice
 * of rung is ours, the range is not. Levels a model is not documented to accept are
 * absent, so they are never offered and never sent.
 */
const GEMINI_PROVIDER = /^google\s*ai$/i;
const GEMINI_LEVELS_FULL = {
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
};
const GEMINI_LEVELS_NO_MINIMAL = {
  low: 'low',
  medium: 'medium',
  high: 'high',
};
const GEMINI_BUDGET_FLASH = { off: 0, low: 1024, medium: 8192, high: 24576 };
const GEMINI_BUDGET_PRO = { low: 1024, medium: 8192, high: 32768 };

/**
 * Anthropic steers depth with `output_config.effort` (the extended-thinking page tells
 * you to drop `budget_tokens` for exactly this), and the rungs differ per model: 4.6 has
 * `max` but no `xhigh`, and Opus 4.5 is still in manual mode where effort rides next to a
 * budget. "Do not think" is not an effort level: it is `thinking.type`, spelled `disabled`
 * nearly everywhere and `between_tools` on Sonnet 5.5 - and Opus 5.5 refuses both at every
 * level, so it gets no off row at all and is never offered one.
 */
const ANTHROPIC_PROVIDER = /^anthropic$/i;
const ANTHROPIC_EFFORTS = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
};
const ANTHROPIC_EFFORTS_NO_XHIGH = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'max',
};
const ANTHROPIC_EFFORTS_MANUAL = { low: 'low', medium: 'medium', high: 'high' };

export const THINKING_MAPPINGS: ThinkingMapping[] = [
  {
    id: 'openai-reasoning',
    description:
      'OpenAI reasoning models take reasoning_effort, including "none"',
    provider: /^openai$/i,
    model: /^(o[1-9][a-z-]*|gpt-5[a-z0-9.-]*)$/i,
    carrier: 'reasoning_effort',
    wire: {
      off: 'none',
      minimal: 'minimal',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
    },
  },
  {
    id: 'openai-compatible-reasoning',
    generic: true,
    description:
      'Self-hosted OpenAI-compatible servers exposing an effort knob (vLLM, SGLang, gateways)',
    provider:
      /(openai[_ -]?compatible|vllm|sglang|lm[\s_-]?studio|one[\s_-]?api|new[\s_-]?api)/i,
    model: /(reasoner|reasoning|-rl|r1|think)/i,
    carrier: 'reasoning_effort',
    // Deliberately no xhigh: a router that advertises an effort knob is not known to
    // serve every tier, and offering a tier we cannot verify is the failure mode here.
    wire: {
      minimal: 'minimal',
      low: 'low',
      medium: 'medium',
      high: 'high',
    },
  },
  {
    id: 'gemini-3-image-thinking-level',
    description: '图像型号只文档化了 minimal 与 high 两档',
    provider: GEMINI_PROVIDER,
    model: /^gemini-3\.1-flash-lite-image/i,
    carrier: 'thinking_level',
    wire: { minimal: 'minimal', high: 'high' },
  },
  {
    id: 'gemini-3-thinking-level',
    description:
      'Gemini 3 用 thinkingLevel；各型号支持的档位不同，未文档化的档位一律不下发',
    provider: GEMINI_PROVIDER,
    model:
      /^(gemini-3\.6-flash|gemini-3\.5-flash-lite|gemini-3\.1-flash-lite|gemini-3-flash)(?!-image)/i,
    carrier: 'thinking_level',
    wire: GEMINI_LEVELS_FULL,
  },
  {
    id: 'gemini-3-no-minimal-thinking-level',
    description: '3.8 Flash 与 3.1 Pro 没有 minimal，也不允许关闭思考',
    provider: GEMINI_PROVIDER,
    model: /^(gemini-3\.8-flash|gemini-3\.1-pro)/i,
    carrier: 'thinking_level',
    wire: GEMINI_LEVELS_NO_MINIMAL,
  },
  {
    id: 'gemini-3-pro-thinking-level',
    description: 'Gemini 3 Pro 只文档化了 low 与 high',
    provider: GEMINI_PROVIDER,
    model: /^gemini-3-pro/i,
    carrier: 'thinking_level',
    wire: { low: 'low', high: 'high' },
  },
  {
    id: 'gemini-25-flash-budget',
    description:
      'Gemini 2.5 Flash / Flash Lite 只认 thinkingBudget，off 就是文档里的预算 0',
    provider: GEMINI_PROVIDER,
    model: /^gemini-2\.5-flash/i,
    carrier: 'thinking_budget',
    wire: GEMINI_BUDGET_FLASH,
  },
  {
    id: 'gemini-25-pro-budget',
    description:
      'Gemini 2.5 Pro 只认 thinkingBudget（128 到 32768），且无法关闭思考，所以没有 off',
    provider: GEMINI_PROVIDER,
    model: /^gemini-2\.5-pro/i,
    carrier: 'thinking_budget',
    wire: GEMINI_BUDGET_PRO,
  },
  {
    id: 'anthropic-effort',
    description:
      'Anthropic 用 output_config.effort 控制深度，不再下发固定 budget',
    provider: ANTHROPIC_PROVIDER,
    model:
      /claude-(fable|mythos|opus|sonnet)-5|claude-opus-4[.\-][78]|claude-haiku-5[.\-]5/i,
    carrier: 'anthropic_effort',
    wire: ANTHROPIC_EFFORTS,
  },
  {
    id: 'anthropic-effort-no-xhigh',
    description: '4.6 有 max 但没有 xhigh',
    provider: ANTHROPIC_PROVIDER,
    model: /claude-(opus|sonnet)-4[.\-]6/i,
    carrier: 'anthropic_effort',
    wire: ANTHROPIC_EFFORTS_NO_XHIGH,
  },
  {
    id: 'anthropic-effort-manual',
    description: 'Opus 4.5 仍走手动预算，这里只给安全的三档',
    provider: ANTHROPIC_PROVIDER,
    model: /claude-opus-4[.\-]5/i,
    carrier: 'anthropic_effort',
    wire: ANTHROPIC_EFFORTS_MANUAL,
  },
  {
    id: 'anthropic-off-between-tools',
    description: 'Sonnet 5.5 最低一档叫 between_tools，不是 disabled',
    provider: ANTHROPIC_PROVIDER,
    model: /claude-sonnet-5[.\-]5/i,
    carrier: 'anthropic_disable',
    wire: { off: 'between_tools' },
  },
  {
    id: 'anthropic-off-disabled',
    description:
      '关闭思考走 thinking.type，不是少发一个字段；Opus 5.5 不接受任何关法',
    provider: ANTHROPIC_PROVIDER,
    model:
      /claude-(fable|mythos|sonnet)-5|claude-opus-5(?![.\-]5)|claude-(opus|sonnet)-4[.\-][5678]|claude-haiku-5[.\-]5/i,
    carrier: 'anthropic_disable',
    wire: { off: 'disabled' },
  },
  {
    id: 'ollama-think',
    description:
      'Ollama takes think true/false only; graded tiers are model-defined and must come from /api/show, so nothing finer is claimed here',
    provider: /^ollama$/i,
    model: /.*/,
    carrier: 'ollama_think',
    wire: { off: false },
  },
];

/**
 * More than one row can describe the same model, because a provider may express one
 * level in a field and another level in a different field - Anthropic's effort rungs
 * live in `output_config`, while "do not think" lives in `thinking.type`. Matching
 * stops at the first row only when asking for one row; asking what is offered unions
 * them, and asking for a level takes the first row that actually advertises it.
 */
export function findThinkingMappings(
  providerName: string,
  modelId: string,
): ThinkingMapping[] {
  return THINKING_MAPPINGS.filter(
    (mapping) =>
      mapping.provider.test(providerName) && mapping.model.test(modelId),
  );
}

export function findThinkingMapping(
  providerName: string,
  modelId: string,
): ThinkingMapping | null {
  return findThinkingMappings(providerName, modelId)[0] ?? null;
}

/**
 * Tiers offered for an endpoint nothing is known about, and the one field name enough
 * OpenAI-compatible servers (vLLM, SGLang, gateways) use for them. Refusing to offer
 * anything left the control dead for exactly the models the owner runs - a level you cannot
 * choose is not a level - while "I do not know this endpoint" remains said out loud: the
 * switch labels the send as generic, and the wire carries `verified: false`.
 *
 * `off` is deliberately absent: no generic "do not think" value is safe to invent, so
 * turning levels off is the explicit *suppress* choice rather than a wire guess. `xhigh`
 * and `max` stay provider-specific for the same reason.
 */
export const GENERIC_THINKING_LEVELS: ThinkingLevel[] = [
  'minimal',
  'low',
  'medium',
  'high',
];

const GENERIC_EFFORT: Partial<Record<ThinkingLevel, string>> = {
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
};

/** True when a row in the table speaks this provider/model pair, tiers included. */
export function isVerifiedThinkingModel(
  providerName: string,
  modelId: string,
): boolean {
  return findThinkingMappings(providerName, modelId).length > 0;
}

/**
 * True when the table recognises this provider as a named service with its own dialect
 * (OpenAI, Anthropic, Gemini, Ollama...). A gateway under an arbitrary name is not one, and
 * neither is "OpenAI Compatible" serving a model the row declines to answer for.
 */
export function isThinkingDialectKnown(providerName: string): boolean {
  return THINKING_MAPPINGS.some(
    (mapping) => !mapping.generic && mapping.provider.test(providerName),
  );
}

/** Levels worth offering in the UI. Never empty: an unknown model gets the generic tiers. */
export function supportedThinkingLevels(
  providerName: string,
  modelId: string,
): ThinkingLevel[] {
  const mappings = findThinkingMappings(providerName, modelId);
  if (mappings.length === 0) {
    // A service the table knows and declined for this model gets nothing: sending a guess
    // to a native API is worse than no tier. An endpoint the table has never met gets the
    // generic field, because the alternative is a control the user cannot use at all.
    return isThinkingDialectKnown(providerName)
      ? []
      : [...GENERIC_THINKING_LEVELS];
  }
  return THINKING_LEVEL_ORDER.filter(
    (level) =>
      level !== 'auto' &&
      mappings.some((mapping) => mapping.wire?.[level] !== undefined),
  );
}

export interface ThinkingWire {
  carrier: ThinkingCarrier;
  field: string;
  value: string | number | boolean;
  /** The level is the more specific statement and replaces anything already set. */
  overrides?: boolean;
  /** False when the field is a generic guess rather than a mapped endpoint behaviour. */
  verified?: boolean;
}

/**
 * The provider-native form of a level, or null when it must not be sent: `auto`, an
 * unmapped provider/model pair, or a level that model does not advertise.
 */
export function thinkingWireFor(
  providerName: string,
  modelId: string,
  level: ThinkingLevel,
): ThinkingWire | null {
  if (level === 'auto') return null;
  for (const mapping of findThinkingMappings(providerName, modelId)) {
    const value = mapping.wire?.[level];
    const field = value === undefined ? null : CARRIER_FIELD[mapping.carrier];
    // `undefined` means "this row does not advertise that level"; a real wire value can
    // be 0 (Gemini's way of saying "do not think") or false (Ollama's), so a truthiness
    // test here would silently drop the one level whose whole point is to be explicit.
    if (value === undefined || !field) continue;
    return {
      carrier: mapping.carrier,
      field,
      value,
      // On Ollama the older boolean and the level both write the same option, and the
      // level is the newer, more specific statement.
      overrides: mapping.carrier === 'ollama_think',
      verified: true,
    };
  }
  // Nothing is known about this endpoint, but the user still chose a tier: send the
  // generic field and say so on the wire.
  if (
    !isVerifiedThinkingModel(providerName, modelId) &&
    !isThinkingDialectKnown(providerName)
  ) {
    const effort = GENERIC_EFFORT[level];
    if (effort) {
      return {
        carrier: 'reasoning_effort',
        field: CARRIER_FIELD.reasoning_effort as string,
        value: effort,
        verified: false,
      };
    }
  }
  return null;
}

/**
 * Some self-hosted routers expose effort tiers as sibling model names (`base-instruct`,
 * `base_llamacpp-medium`) instead of a field. The suffix map comes from configuration
 * the operator already has a place to write - the model's advanced parameters - because
 * baking one person's fleet names into the product would be its own kind of lie.
 *
 * Returns the model unchanged when there is no template or no level. When a template
 * exists but has no sibling for the chosen level it throws: guessing a name means a
 * confusing router error mid-generation, while failing here names the level and model.
 */
export function resolveThinkingModelName(args: {
  model: string;
  level?: ThinkingLevel | string;
  suffixes?: Record<string, string> | null;
}): string {
  const { model, level, suffixes } = args;
  // An empty map means "no template configured", which is not the same as a template
  // that is missing one level.
  if (
    !suffixes ||
    !level ||
    level === 'auto' ||
    Object.keys(suffixes).length === 0
  ) {
    return model;
  }
  const suffix = suffixes[level];
  if (typeof suffix !== 'string') {
    throw new Error(
      `thinking level "${level}" has no model name for ${model}; ` +
        `configured levels: ${Object.keys(suffixes).join(', ') || 'none'}`,
    );
  }
  return `${model}${suffix}`;
}

/**
 * What the model does when nothing is sent - the only level that costs nothing to choose,
 * because the documentation says an effort equal to the default is equivalent to omitting
 * it, and prompt caching is keyed on the resolved value.
 */
export function anthropicDefaultEffort(modelId: string): string | null {
  if (findThinkingMappings('Anthropic', modelId).length === 0) return null;
  return /claude-(opus|haiku)-5[.\-]5/i.test(modelId) ? 'medium' : 'high';
}
