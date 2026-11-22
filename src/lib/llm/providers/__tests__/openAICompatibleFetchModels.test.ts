import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriFetch = vi.fn();
vi.mock('@/lib/request', () => ({
  tauriFetch: (...args: unknown[]) => tauriFetch(...args),
}));

import { OpenAICompatibleProvider } from '@/lib/llm/providers/OpenAICompatibleProvider';

describe('OpenAICompatibleProvider.fetchModels failure semantics', () => {
  beforeEach(() => {
    tauriFetch.mockReset();
  });

  it('returns null when the endpoint is unreachable and it has no static fallback', async () => {
    tauriFetch.mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:1234'),
    );
    const provider = new OpenAICompatibleProvider(
      'http://127.0.0.1:1234/v1',
      undefined,
      'LM Studio',
    );

    // null means "unknown" for ProviderModelService; [] would mean "the provider has no models"
    // and would delete manually added ones.
    await expect(provider.fetchModels()).resolves.toBeNull();
  });

  it('returns an empty array when the server answers with an empty list', async () => {
    tauriFetch.mockResolvedValue({ data: [] });
    const provider = new OpenAICompatibleProvider(
      'http://127.0.0.1:1234/v1',
      undefined,
      'LM Studio',
    );

    await expect(provider.fetchModels()).resolves.toEqual([]);
  });

  it('maps the ids the server reports', async () => {
    tauriFetch.mockResolvedValue({
      data: [{ id: 'qwen-test' }, { id: 'llama-3', label: 'Llama 3' }],
    });
    const provider = new OpenAICompatibleProvider(
      'http://127.0.0.1:1234/v1',
      undefined,
      'LM Studio',
    );

    const models = await provider.fetchModels();

    expect(models?.map((m) => m.name)).toEqual(['qwen-test', 'llama-3']);
    expect(models?.[1].label).toBe('Llama 3');
  });

  it('still falls back to the static list for providers that ship one', async () => {
    tauriFetch.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const provider = new OpenAICompatibleProvider(
      'https://api.deepseek.com',
      undefined,
      'DeepSeek',
    );

    const models = await provider.fetchModels();

    expect(models?.length).toBeGreaterThan(0);
    expect(models?.map((m) => m.name)).toContain('deepseek-chat');
  });
});
