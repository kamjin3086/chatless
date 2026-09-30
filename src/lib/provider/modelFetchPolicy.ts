export const NO_KEY_MODEL_REFRESH_MIN_INTERVAL_MS = 2 * 60 * 1000;

export type FetchModelsOptions = {
  ttl?: number;
  /** 忽略节流，立即拉取（手动刷新） */
  force?: boolean;
  /** 距上次拉取不足该间隔则跳过；0 / 缺省表示不节流 */
  minIntervalMs?: number;
};

export function isNoKeyProvider(provider: {
  requiresKey?: boolean;
  requiresApiKey?: boolean;
}): boolean {
  if (typeof provider.requiresKey === 'boolean') return provider.requiresKey === false;
  if (typeof provider.requiresApiKey === 'boolean') return provider.requiresApiKey === false;
  return false;
}

/**
 * Providers whose model list should be refreshed silently when the picker
 * opens:免密 providers, plus providers the user added by hand.  For a custom
 * endpoint `requiresKey` is only a static guess (usually `strategy !== 'ollama'`),
 * so excluding user-added providers left their model list stale until a manual
 * refresh in settings.
 */
export function isAutoRefreshProvider(provider: {
  requiresKey?: boolean;
  requiresApiKey?: boolean;
  isUserAdded?: boolean;
}): boolean {
  if (provider.isUserAdded === true) return true;
  return isNoKeyProvider(provider);
}

export function shouldSkipModelFetch(
  lastFetchAt: number | undefined,
  now: number,
  options?: Pick<FetchModelsOptions, 'force' | 'minIntervalMs'>
): boolean {
  if (options?.force) return false;
  const minIntervalMs = options?.minIntervalMs ?? 0;
  if (minIntervalMs <= 0 || lastFetchAt == null) return false;
  return now - lastFetchAt < minIntervalMs;
}

export async function refreshAutoProviderModels(
  providers: Array<{ name: string; requiresKey?: boolean; requiresApiKey?: boolean; isUserAdded?: boolean }>,
  fetchIfNeeded: (name: string, options?: FetchModelsOptions) => Promise<void>,
  options?: { force?: boolean }
): Promise<void> {
  const minIntervalMs = options?.force ? 0 : NO_KEY_MODEL_REFRESH_MIN_INTERVAL_MS;
  await Promise.allSettled(
    providers
      .filter(isAutoRefreshProvider)
      .map((provider) =>
        fetchIfNeeded(provider.name, {
          force: options?.force,
          minIntervalMs,
        })
      )
  );
}
