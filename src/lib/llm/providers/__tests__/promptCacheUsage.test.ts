import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPromptCacheStats, resetPromptCacheMetrics } from '@/lib/llm/promptCacheMetrics';
import { OpenAICompatibleProvider } from '../OpenAICompatibleProvider';

/**
 * A real SSE stream ends with a usage frame.  The provider must turn the
 * provider-reported cache counters into a recorded sample, otherwise the app
 * cannot tell whether the stable prompt prefix is actually being reused.
 */

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/request', () => ({ tauriFetch: mocks.fetch }));

beforeEach(() => {
  vi.resetAllMocks();
  resetPromptCacheMetrics();
});

describe('provider prompt cache accounting', () => {
  it('records cached tokens from the trailing usage frame', async () => {
    mocks.fetch.mockResolvedValue(new Response([
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"model":"qwen","usage":{"prompt_tokens":4000,"prompt_tokens_details":{"cached_tokens":3200}}}',
      'data: [DONE]',
      '',
    ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } }));

    const provider = new OpenAICompatibleProvider('https://example.test/v1', undefined, 'fixture');
    vi.spyOn(provider as any, 'getApiKey').mockResolvedValue('fixture');
    await provider.chatStream('qwen', [{ role: 'user', content: 'hi' }], { onEvent: vi.fn() });

    const stats = getPromptCacheStats();
    expect(stats.reporting).toBe(1);
    expect(stats.lastCachedTokens).toBe(3200);
    expect(stats.lastPromptTokens).toBe(4000);
    expect(stats.lastCachedRatio).toBeCloseTo(0.8, 5);
  });
});
