/**
 * Context window discovery.
 *
 * Providers report the window in different places, and most report nothing at
 * all. This reads the shapes we have actually seen (llama-swap exposes
 * `meta.llamaswap.context`; other gateways use `context_length` or
 * `context_window`). No guessing from the model name: an unknown window must
 * stay unknown, because `resolveOutputBudget` treats unknown as "send nothing".
 */

const WINDOW_FIELDS = [
  'context_length',
  'contextLength',
  'context_window',
  'contextWindow',
  'max_context_length',
  'max_input_tokens',
] as const;

function toPositiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

/** Reads a context window out of one model entry from a provider's model list. */
export function readContextWindow(raw: unknown): number | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const item = raw as Record<string, any>;

  for (const field of WINDOW_FIELDS) {
    const found = toPositiveInt(item[field]);
    if (found) return found;
  }
  for (const metaKey of ['meta', 'metadata', 'model_info', 'details']) {
    const meta = item[metaKey];
    if (!meta || typeof meta !== 'object') continue;
    for (const field of WINDOW_FIELDS) {
      const found = toPositiveInt((meta as Record<string, any>)[field]);
      if (found) return found;
    }
    // llama-swap nests it one level deeper: meta.llamaswap.context
    for (const nested of Object.values(meta as Record<string, any>)) {
      if (!nested || typeof nested !== 'object') continue;
      for (const field of WINDOW_FIELDS) {
        const found = toPositiveInt((nested as Record<string, any>)[field]);
        if (found) return found;
      }
      const context = toPositiveInt((nested as Record<string, any>).context);
      if (context) return context;
    }
  }
  return undefined;
}
