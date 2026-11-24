import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriFetch = vi.fn();
vi.mock('@/lib/request', () => ({
  tauriFetch: (...args: unknown[]) => tauriFetch(...args),
}));

const getAll = vi.fn();
vi.mock('@/lib/provider/ProviderRepository', () => ({
  providerRepository: { getAll: (...args: unknown[]) => getAll(...args) },
}));

import { defaultCacheManager } from '@/lib/cache/CacheManager';
import { modelRepository } from '@/lib/provider/ModelRepository';
import { providerModelService } from '@/lib/provider/services/ProviderModelService';

const PROVIDER = 'LM Studio';

describe('forced model refresh against an unreachable provider', () => {
  beforeEach(async () => {
    tauriFetch.mockReset();
    getAll.mockReset();
    getAll.mockResolvedValue([
      {
        name: PROVIDER,
        url: 'http://localhost:1234/v1',
        requiresKey: false,
        strategy: 'openai-compatible',
      },
    ]);
    tauriFetch.mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:1234'),
    );
    await defaultCacheManager.evict(`models:${PROVIDER}`);
  });

  it('keeps a manually added model in the list', async () => {
    await modelRepository.save(PROVIDER, [
      {
        provider: PROVIDER,
        name: 'qwen-test',
        label: 'qwen-test',
        aliases: ['qwen-test'],
      },
    ] as any);

    await providerModelService.fetchIfNeeded(PROVIDER, { force: true });

    const models = (await modelRepository.get(PROVIDER)) || [];
    expect(models.map((m) => m.name)).toEqual(['qwen-test']);
  });
});
