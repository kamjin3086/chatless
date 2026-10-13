/**
 * The dialog has to refuse a combination the API will refuse, and say which one, instead
 * of adjusting one of the two numbers on the user's behalf (#98). Everything here is a
 * pure decision so the rule can be read, tested, and reused by the session dialog later;
 * the strings are i18n keys, never prose baked into logic.
 *
 * The rules are the documented ones, not a taste for validation:
 *   - `thinking: {type: "disabled"}` is a 400 together with `xhigh`/`max` on Opus 5,
 *     Sonnet 5.5 and Haiku 5.5, and a 400 at every level on Opus 5.5.
 *   - a manual `budget_tokens` must be at least 1024 and strictly less than `max_tokens`
 *     (the extended-thinking page; only models still in manual mode can hit this).
 *   - `max_tokens` is a hard cap that includes thinking, and the docs suggest starting
 *     near 64k at `xhigh`/`max`. That is worth a sentence, not a refusal: the request is
 *     legal and may be exactly what the user wants.
 */
import { DEFAULT_MAX_OUTPUT_TOKENS } from '@/lib/llm/outputBudget';
import {
  anthropicDefaultEffort,
  findThinkingMappings,
  type ThinkingLevel,
} from '@/lib/llm/thinkingLevels';

export type ThinkingIssueKind = 'blocked' | 'warn';

export interface ThinkingIssue {
  kind: ThinkingIssueKind;
  /** i18n key; the messages are static so no interpolation is needed. */
  key: string;
}

const ANTHROPIC = /^anthropic$/i;
/** `low`..`high` only, i.e. not one of the two deep rungs. */
const DEEP_RUNGS = new Set(['xhigh', 'max']);
/**
 * Models where the docs make a way of turning thinking off a 400 at the deep rungs:
 * Opus 5 (not 5.5, which is refused everywhere), Sonnet 5.5 and Haiku 5.5.
 */
const DEEP_RUNG_REFUSES_OFF =
  /claude-opus-5(?![.\-]5)|claude-sonnet-5[.\-]5|claude-haiku-5[.\-]5/i;
/** Thinking is always on here, so there is no way to turn it off at any level. */
const CANNOT_DISABLE_THINKING = /claude-opus-5[.\-]5/i;
/** Below this, the docs' advice at the deep rungs is that thinking eats the answer. */
const DEEP_RUNG_OUTPUT_ROOM = 64000;

export interface ThinkingRequestCheck {
  providerName: string;
  modelId: string;
  level: ThinkingLevel | undefined;
  /** The limit that will actually go on the wire; undefined means the app's fallback. */
  maxOutputTokens: number | undefined;
  /** Parsed advanced options (raw JSON the user wrote), if any. */
  advanced?: Record<string, any> | null;
}

function effectiveMaxTokens(value: number | undefined): number {
  return typeof value === 'number' && value > 0
    ? value
    : DEFAULT_MAX_OUTPUT_TOKENS;
}

/**
 * Returns the most serious problem with the combination as it stands, or null. Never
 * suggests a replacement value: the point is that nothing gets quietly rewritten.
 */
export function validateThinkingRequest(
  check: ThinkingRequestCheck,
): ThinkingIssue | null {
  const { providerName, modelId, advanced } = check;
  if (!ANTHROPIC.test(providerName)) return null;

  const level = check.level ?? 'auto';
  const advancedThinking =
    advanced?.thinking && typeof advanced.thinking === 'object'
      ? advanced.thinking
      : undefined;
  const advancedEffort =
    advanced?.output_config && typeof advanced.output_config === 'object'
      ? advanced.output_config.effort
      : undefined;

  // A manual budget is the one place where "this cannot work" is arithmetic. The rule
  // is applied wherever a budget is present: on a model that has moved to adaptive
  // thinking the API rejects the field outright, so refusing it here is not a lie.
  if (advancedThinking?.type === 'enabled') {
    const budget = Number(advancedThinking.budget_tokens);
    const maxTokens = effectiveMaxTokens(check.maxOutputTokens);
    if (Number.isFinite(budget) && budget >= maxTokens) {
      return {
        kind: 'blocked',
        key: 'modelParams.thinking.conflictBudgetAboveMax',
      };
    }
    if (Number.isFinite(budget) && budget < 1024) {
      return {
        kind: 'blocked',
        key: 'modelParams.thinking.conflictBudgetTooSmall',
      };
    }
  }

  // Is thinking being turned off, by the level or by raw JSON?
  const disabledRequested =
    level === 'off' ||
    advancedThinking?.type === 'disabled' ||
    advancedThinking?.type === 'between_tools';
  // The deep rung can come from the level or from raw JSON.
  const deep = DEEP_RUNGS.has(level) || DEEP_RUNGS.has(String(advancedEffort));

  if (disabledRequested) {
    if (CANNOT_DISABLE_THINKING.test(modelId)) {
      return {
        kind: 'blocked',
        key: 'modelParams.thinking.conflictDisabledUnsupported',
      };
    }
    // Either way the API refuses "do not think" together with a deep rung.
    if (deep && DEEP_RUNG_REFUSES_OFF.test(modelId)) {
      return {
        kind: 'blocked',
        key: 'modelParams.thinking.conflictEffortDisabled',
      };
    }
  }

  // Legal, just usually not what the user meant: thinking counts against max_tokens, so
  // a deep rung under the limit the docs suggest tends to come back truncated.
  if (
    deep &&
    effectiveMaxTokens(check.maxOutputTokens) < DEEP_RUNG_OUTPUT_ROOM
  ) {
    return { kind: 'warn', key: 'modelParams.thinking.warnEffortNeedsRoom' };
  }

  return null;
}

/**
 * Prompt-cache consequence, which only the user can weigh: effort and thinking settings
 * are part of what a cache breakpoint is keyed on, so changing them between turns throws
 * away the cached prefix. Setting the level to what the model already does by default is
 * documented to be equivalent to omitting it, so that case stays quiet - as does `auto`,
 * which sends nothing at all.
 */
export function thinkingCacheNotice(check: {
  providerName: string;
  modelId: string;
  level: ThinkingLevel | undefined;
}): string | null {
  const { providerName, modelId } = check;
  if (!ANTHROPIC.test(providerName)) return null;
  const level = check.level ?? 'auto';
  if (level === 'auto') return null;

  const mappings = findThinkingMappings(providerName, modelId);
  if (mappings.length === 0) return null;

  if (level === 'off') return 'modelParams.thinking.cacheNotice';

  // The wire value is what matters: a level whose wire form is already what the model
  // does by default changes nothing, and the docs say so explicitly about the cache.
  const effort = mappings
    .map((mapping) => mapping.wire?.[level])
    .find((value) => value !== undefined);
  if (effort === undefined) return null;
  if (effort === anthropicDefaultEffort(modelId)) return null;

  return 'modelParams.thinking.cacheNotice';
}
