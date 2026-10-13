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

/** Ordered from "let the model decide" through "think as long as you need". */
export type ThinkingLevel =
  | 'auto'
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';

/** How a level reaches a given provider. */
export type ThinkingCarrier =
  | 'reasoning_effort'
  | 'thinking_level'
  | 'thinking_budget'
  | 'ollama_think'
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
];

/** Wire field a carrier is expressed as. Levels not in `wire` are not offered. */
const CARRIER_FIELD: Record<ThinkingCarrier, string | null> = {
  reasoning_effort: 'reasoning_effort',
  thinking_level: 'thinking_level',
  thinking_budget: 'thinking_budget',
  model_alias: null,
  unsupported: null,
  // Ollama's API field is `think`, but the provider already translates this repo's
  // internal `thinking` option into that body field, so the carrier aims at the option
  // that path already reads instead of inventing a second one.
  ollama_think: 'thinking',
};

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
  carrier: ThinkingCarrier;
  /** level -> wire value. `auto` is never mapped: it means send nothing. */
  wire?: Partial<Record<ThinkingLevel, string | number | boolean>>;
}

/**
 * Known-good rows only. A row here is a claim that this provider/model accepts these
 * levels in this field, so an unlisted model is reported as unverified rather than
 * guessed at - the same rule as everywhere else in this repo.
 */
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
    id: 'ollama-think',
    description:
      'Ollama takes think true/false only; graded tiers are model-defined and must come from /api/show, so nothing finer is claimed here',
    provider: /^ollama$/i,
    model: /.*/,
    carrier: 'ollama_think',
    wire: { off: false },
  },
];

export function findThinkingMapping(
  providerName: string,
  modelId: string,
): ThinkingMapping | null {
  for (const mapping of THINKING_MAPPINGS) {
    if (mapping.provider.test(providerName) && mapping.model.test(modelId)) {
      return mapping;
    }
  }
  return null;
}

/** Levels worth offering in the UI. Empty means "unverified: send nothing". */
export function supportedThinkingLevels(
  providerName: string,
  modelId: string,
): ThinkingLevel[] {
  const mapping = findThinkingMapping(providerName, modelId);
  if (!mapping || !mapping.wire) return [];
  return THINKING_LEVEL_ORDER.filter(
    (level) => level !== 'auto' && mapping.wire?.[level] !== undefined,
  );
}

export interface ThinkingWire {
  carrier: ThinkingCarrier;
  field: string;
  value: string | number | boolean;
  /** The level is the more specific statement and replaces anything already set. */
  overrides?: boolean;
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
  const mapping = findThinkingMapping(providerName, modelId);
  if (!mapping) return null;
  const value = mapping.wire?.[level];
  if (value === undefined) return null;
  const field = CARRIER_FIELD[mapping.carrier];
  if (!field) return null;
  return {
    carrier: mapping.carrier,
    field,
    value,
    // On Ollama the older boolean and the level both write the same option, and the
    // level is the newer, more specific statement.
    overrides: mapping.carrier === 'ollama_think',
  };
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
