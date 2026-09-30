/**
 * Prompt cache accounting.
 *
 * Providers report prefix-cache usage in different fields.  Recording them lets
 * the app prove whether the stable prompt prefix is actually being reused, and
 * an endpoint that reports nothing is recorded as `unknown` instead of 0.
 */

export interface PromptCacheSample {
  /** Provider that reported the numbers. */
  source: string;
  /** Model of the request, when the provider echoes it. */
  model?: string;
  /** Input tokens billed for this request, when reported. */
  promptTokens?: number;
  /** Input tokens served from the provider's cache. */
  cachedTokens?: number;
  /** Tokens written into the cache (Anthropic style). */
  cacheCreationTokens?: number;
  recordedAt: number;
}

export interface PromptCacheStats {
  samples: number;
  reporting: number;
  unknown: number;
  /** Source of the most recent sample that reported cache usage. */
  lastReportingSource?: string;
  lastCachedTokens?: number;
  lastPromptTokens?: number;
  /** Share of the last request's input that came from cache, when known. */
  lastCachedRatio?: number;
}

const MAX_SAMPLES = 200;
const samples: PromptCacheSample[] = [];

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Extract the cache fields from an OpenAI/Anthropic/DeepSeek usage object. */
export function parsePromptCacheUsage(
  usage: unknown,
  source: string,
  model?: string,
): PromptCacheSample | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const usageObj = usage as Record<string, any>;
  const details = (usageObj.prompt_tokens_details || usageObj.input_tokens_details || {}) as Record<string, unknown>;

  const cachedTokens =
    toNumber(details.cached_tokens)
    ?? toNumber(usageObj.prompt_cache_hit_tokens)
    ?? toNumber(usageObj.cache_read_input_tokens);
  const cacheCreationTokens =
    toNumber(usageObj.cache_creation_input_tokens)
    ?? toNumber(details.cache_creation_tokens);
  const promptTokens =
    toNumber(usageObj.prompt_tokens)
    ?? toNumber(usageObj.input_tokens);

  if (cachedTokens === undefined && cacheCreationTokens === undefined && promptTokens === undefined) {
    return undefined;
  }
  return { source, model, promptTokens, cachedTokens, cacheCreationTokens, recordedAt: Date.now() };
}

export function recordPromptCacheUsage(sample: PromptCacheSample | undefined): void {
  if (!sample) return;
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  console.debug(
    `[prompt-cache] ${sample.source}${sample.model ? ` ${sample.model}` : ''}:`
    + ` cached=${sample.cachedTokens ?? 'unknown'}`
    + `${sample.promptTokens !== undefined ? ` prompt=${sample.promptTokens}` : ''}`
    + `${sample.cacheCreationTokens !== undefined ? ` written=${sample.cacheCreationTokens}` : ''}`,
  );
}

/** Record a request whose provider did not report cache fields. */
export function recordPromptCacheUnknown(source: string, model?: string): void {
  recordPromptCacheUsage({ source, model, recordedAt: Date.now() });
}

export function getPromptCacheStats(): PromptCacheStats {
  const reportingSamples = samples.filter((sample) => sample.cachedTokens !== undefined);
  // "Last" describes the most recent request that actually reported cache
  // usage; an endpoint that reports nothing must not erase the last real number.
  const last = reportingSamples[reportingSamples.length - 1];
  const known = last?.promptTokens !== undefined && last.promptTokens > 0
    ? (last.cachedTokens || 0) / last.promptTokens
    : undefined;
  return {
    samples: samples.length,
    reporting: reportingSamples.length,
    unknown: samples.length - reportingSamples.length,
    lastReportingSource: last?.source,
    lastCachedTokens: last?.cachedTokens,
    lastPromptTokens: last?.promptTokens,
    lastCachedRatio: known,
  };
}

export function resetPromptCacheMetrics(): void {
  samples.length = 0;
}
