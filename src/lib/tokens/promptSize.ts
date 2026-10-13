/**
 * Sizing a prompt and its tool schemas.
 *
 * Two divisors have been used in this repo. `JSON.stringify(x).length / 2.5` is the old
 * one, and it is a Chinese-text rule: for English it overstates by roughly two thirds.
 * Every model-facing prompt in this app is English (`docs/prompt-language.md`), including
 * the agent contract and every tool description, so the contract and the schemas are
 * measured here with the language-aware estimator in `@/lib/rag/tokenEstimate`: CJK text
 * at about one token per character, everything else at about four characters per token.
 *
 * What this deliberately does not do: pretend to be a tokenizer. There is no tokenizer
 * dependency here, and the only real count is the endpoint's. The point of an estimate is
 * to notice when the prompt has grown, so the rule is one documented divisor applied
 * consistently, and a cap that was measured rather than remembered.
 */
import { estimateTokens as estimateTextTokens } from '@/lib/rag/tokenEstimate';

/** Characters per token this repo assumes for non-CJK text. */
export const NON_CJK_CHARS_PER_TOKEN = 4;

/** Estimate for a set of tool schemas as they go on the wire. */
export function schemaTokenEstimate(schemas: unknown): number {
  return estimateTextTokens(JSON.stringify(schemas ?? []));
}

/** Estimate for prompt text: the contract block, a system message, an answer. */
export function promptTokenEstimate(text: string): number {
  return estimateTextTokens(text || '');
}

/** The old Chinese-text rule, kept so the disagreement stays testable. */
export function legacyCharDivisorEstimate(
  value: unknown,
  divisor = 2.5,
): number {
  return Math.ceil(JSON.stringify(value ?? []).length / divisor);
}

/**
 * Measured on 2026-10-13 with the estimator above, against the production envelope the
 * app actually sends (agent contract + 18 tool schemas; +3 knowledge schemas when
 * knowledge material is mounted). Reproduced by
 * `docs/acceptance/prompt-budget.audit.test.ts`, which fails if the numbers move.
 *
 *   contract              1847 chars ->   462 tokens
 *   18 tool schemas       9417 chars ->  2355 tokens
 *   + 3 knowledge        11690 chars ->  2923 tokens
 *   prompt + tools                             2817
 *   prompt + tools + knowledge                 3385   <- the largest case today
 */
export const MEASURED_PROMPT_TOKENS = {
  contract: 462,
  toolSchemas: 2355,
  toolSchemasWithKnowledge: 2923,
  promptWithTools: 2817,
  promptWithToolsAndKnowledge: 3385,
} as const;

/**
 * The cap on prompt + tool schemas, derived from the measurement above rather than
 * remembered: the largest case is 3385, and 4000 leaves room for roughly two more tool
 * schemas before someone has to raise it deliberately. The audit bounds it from both
 * sides - over the cap fails, and so does sitting below half of it, which would mean the
 * cap has quietly turned into a fiction.
 */
export const PROMPT_AND_TOOLS_TOKEN_CAP = 4000;
