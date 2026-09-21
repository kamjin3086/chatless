import { beforeEach, describe, expect, it } from 'vitest';
import {
  getPromptCacheStats,
  parsePromptCacheUsage,
  recordPromptCacheUnknown,
  recordPromptCacheUsage,
  resetPromptCacheMetrics,
} from '../promptCacheMetrics';

beforeEach(() => resetPromptCacheMetrics());

describe('prompt cache metrics', () => {
  it('reads OpenAI-compatible cached tokens', () => {
    const sample = parsePromptCacheUsage(
      { prompt_tokens: 4000, prompt_tokens_details: { cached_tokens: 3200 } },
      'openai-compatible',
      'qwen',
    );

    expect(sample).toMatchObject({ cachedTokens: 3200, promptTokens: 4000, source: 'openai-compatible', model: 'qwen' });
  });

  it('reads Anthropic and DeepSeek cache fields', () => {
    expect(parsePromptCacheUsage(
      { input_tokens: 1000, cache_read_input_tokens: 800, cache_creation_input_tokens: 200 },
      'anthropic',
    )).toMatchObject({ cachedTokens: 800, cacheCreationTokens: 200, promptTokens: 1000 });

    expect(parsePromptCacheUsage(
      { prompt_tokens: 900, prompt_cache_hit_tokens: 300 },
      'deepseek',
    )).toMatchObject({ cachedTokens: 300, promptTokens: 900 });
  });

  it('ignores usage objects without any cache or token field', () => {
    expect(parsePromptCacheUsage({}, 'openai-compatible')).toBeUndefined();
    expect(parsePromptCacheUsage(undefined, 'openai-compatible')).toBeUndefined();
  });

  it('separates endpoints that report cache usage from those that do not', () => {
    recordPromptCacheUsage(parsePromptCacheUsage(
      { prompt_tokens: 2000, prompt_tokens_details: { cached_tokens: 1500 } },
      'openai-compatible',
    ));
    recordPromptCacheUnknown('homelab');

    const stats = getPromptCacheStats();
    expect(stats.samples).toBe(2);
    expect(stats.reporting).toBe(1);
    expect(stats.unknown).toBe(1);
    expect(stats.lastReportingSource).toBe('openai-compatible');
    expect(stats.lastCachedTokens).toBe(1500);
    expect(stats.lastCachedRatio).toBeCloseTo(0.75, 5);
  });
});
