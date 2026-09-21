import { describe, expect, it, vi } from 'vitest';
import { AVAILABLE_PROVIDERS_CATALOG } from '@/lib/provider/catalog';
import {
  NO_KEY_MODEL_REFRESH_MIN_INTERVAL_MS,
  isNoKeyProvider,
  isAutoRefreshProvider,
  refreshAutoProviderModels,
  shouldSkipModelFetch,
} from '@/lib/provider/modelFetchPolicy';

describe('isNoKeyProvider', () => {
  it('prefers requiresKey over requiresApiKey', () => {
    expect(isNoKeyProvider({ requiresKey: false, requiresApiKey: true })).toBe(true);
    expect(isNoKeyProvider({ requiresKey: true, requiresApiKey: false })).toBe(false);
  });

  it('falls back to requiresApiKey for UI metadata', () => {
    expect(isNoKeyProvider({ requiresApiKey: false })).toBe(true);
    expect(isNoKeyProvider({ requiresApiKey: true })).toBe(false);
  });

  it('matches catalog local providers and excludes keyed ones', () => {
    const ollama = AVAILABLE_PROVIDERS_CATALOG.find((p) => p.id === 'ollama');
    const lmstudio = AVAILABLE_PROVIDERS_CATALOG.find((p) => p.id === 'lmstudio');
    const deepseek = AVAILABLE_PROVIDERS_CATALOG.find((p) => p.id === 'deepseek');
    expect(isNoKeyProvider(ollama!)).toBe(true);
    expect(isNoKeyProvider(lmstudio!)).toBe(true);
    expect(isNoKeyProvider(deepseek!)).toBe(false);
  });
});

describe('shouldSkipModelFetch', () => {
  const now = 1_000_000;

  it('never skips when force is true', () => {
    expect(shouldSkipModelFetch(now - 1, now, { force: true, minIntervalMs: 60_000 })).toBe(false);
  });

  it('does not skip without a prior fetch or interval', () => {
    expect(shouldSkipModelFetch(undefined, now, { minIntervalMs: 60_000 })).toBe(false);
    expect(shouldSkipModelFetch(now - 1, now)).toBe(false);
    expect(shouldSkipModelFetch(now - 1, now, { minIntervalMs: 0 })).toBe(false);
  });

  it('skips only within the interval', () => {
    expect(shouldSkipModelFetch(now - 1_000, now, { minIntervalMs: 60_000 })).toBe(true);
    expect(shouldSkipModelFetch(now - 61_000, now, { minIntervalMs: 60_000 })).toBe(false);
  });
});

describe('isAutoRefreshProvider', () => {
  it('includes no-key providers and providers the user added by hand', () => {
    expect(isAutoRefreshProvider({ requiresKey: false })).toBe(true);
    expect(isAutoRefreshProvider({ requiresKey: true, isUserAdded: true })).toBe(true);
    expect(isAutoRefreshProvider({ requiresKey: true })).toBe(false);
  });
});

describe('refreshAutoProviderModels', () => {
  it('fetches no-key and user-added providers with the default interval', async () => {
    const fetchIfNeeded = vi.fn().mockResolvedValue(undefined);
    await refreshAutoProviderModels(
      [
        { name: 'Ollama', requiresKey: false },
        { name: 'DeepSeek', requiresKey: true },
        { name: 'LM Studio', requiresApiKey: false },
        { name: 'homelab', requiresKey: true, isUserAdded: true },
      ],
      fetchIfNeeded
    );
    expect(fetchIfNeeded).toHaveBeenCalledTimes(3);
    expect(fetchIfNeeded).toHaveBeenCalledWith('Ollama', {
      force: undefined,
      minIntervalMs: NO_KEY_MODEL_REFRESH_MIN_INTERVAL_MS,
    });
    expect(fetchIfNeeded).toHaveBeenCalledWith('homelab', {
      force: undefined,
      minIntervalMs: NO_KEY_MODEL_REFRESH_MIN_INTERVAL_MS,
    });
    expect(fetchIfNeeded).toHaveBeenCalledWith('LM Studio', {
      force: undefined,
      minIntervalMs: NO_KEY_MODEL_REFRESH_MIN_INTERVAL_MS,
    });
  });

  it('passes force through and disables interval', async () => {
    const fetchIfNeeded = vi.fn().mockResolvedValue(undefined);
    await refreshAutoProviderModels(
      [{ name: 'Ollama', requiresKey: false }],
      fetchIfNeeded,
      { force: true }
    );
    expect(fetchIfNeeded).toHaveBeenCalledWith('Ollama', {
      force: true,
      minIntervalMs: 0,
    });
  });
});
