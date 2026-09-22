/**
 * How many output tokens a request may use.
 *
 * One function decides this everywhere - the request body and the context
 * manager's output reservation - so "what we promise the model" and "what we
 * budget for" can never drift apart.
 *
 * The default only applies when the model's context window is actually known.
 * Sending a large `max_tokens` to an endpoint with a small or unknown window is
 * how requests start failing with 400s, so an unknown window keeps the previous
 * behaviour: send nothing and let the server decide.
 */

/** Output budget used when the window is known but no user value is set. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
/** Never shrink below this unless the window itself is smaller. */
export const MIN_ADAPTIVE_OUTPUT_TOKENS = 2048;

function positiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

/**
 * @param contextWindow Model's total context window, when the provider reports
 *   it or the user set it. Unknown means "do not send max_tokens".
 * @param userMaxTokens Value the user configured; it wins, clamped to the window.
 * @returns The `max_tokens` to send, or undefined to send nothing.
 */
export function resolveOutputBudget(params: {
  contextWindow?: number | null;
  userMaxTokens?: number | null;
}): number | undefined {
  const window = positiveInt(params.contextWindow);
  const requested = positiveInt(params.userMaxTokens);

  if (requested) {
    return window ? Math.min(requested, window) : requested;
  }
  if (!window) return undefined;

  const adaptive = Math.min(
    DEFAULT_MAX_OUTPUT_TOKENS,
    Math.max(MIN_ADAPTIVE_OUTPUT_TOKENS, Math.floor(window / 4)),
  );
  return Math.max(1, Math.min(adaptive, window));
}
