import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(async (_entity: Record<string, unknown>) => {}),
}));

vi.mock('../ProviderRepository', () => ({
  providerRepository: {
    getAll: async () => [],
    upsert: mocks.upsert,
    setVisibility: vi.fn(),
  },
}));
vi.mock('../ModelRepository', () => ({
  modelRepository: { save: async () => {} },
}));
vi.mock('@/lib/llm', () => ({ syncDynamicProviders: async () => {} }));

import { EnsureProviderEnabledUseCase } from '../usecases/EnsureProviderEnabled';

/**
 * Enabling a provider writes its first status, and that status is what the model rows and
 * the badge display long after. Filing a keyless endpoint as "missing a key" at creation is
 * how #118's badge survived a fix to the send path, so the creation path is held to the same
 * rule as everything else.
 */
describe('the status written when a provider is first enabled', () => {
  beforeEach(() => mocks.upsert.mockClear());

  it('does not claim a missing key for a self-hosted default', async () => {
    // "New API" is catalogued as needing a key and points at loopback by default.
    await new EnsureProviderEnabledUseCase().execute('New API');
    const entity = mocks.upsert.mock.calls[0][0] as {
      requiresKey: boolean;
      status: string;
    };
    expect(entity.requiresKey).toBe(false);
    expect(entity.status).not.toBe('NO_KEY');
  });

  it('does not claim a missing key for an address the catalogue has never heard of', async () => {
    await new EnsureProviderEnabledUseCase().execute('Nebula Gateway');
    expect(
      (mocks.upsert.mock.calls[0][0] as { status: string }).status,
    ).not.toBe('NO_KEY');
  });

  it('still says a hosted service is missing its key', async () => {
    await new EnsureProviderEnabledUseCase().execute('DeepSeek');
    expect((mocks.upsert.mock.calls[0][0] as { status: string }).status).toBe(
      'NO_KEY',
    );
  });
});
