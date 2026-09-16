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

export async function refreshNoKeyProviderModels(
  providers: Array<{ name: string; requiresKey?: boolean; requiresApiKey?: boolean }>,
  fetchIfNeeded: (name: string, options?: FetchModelsOptions) => Promise<void>,
  options?: { force?: boolean }
): Promise<void> {
  const minIntervalMs = options?.force ? 0 : NO_KEY_MODEL_REFRESH_MIN_INTERVAL_MS;
  await Promise.allSettled(
    providers
      .filter(isNoKeyProvider)
      .map((provider) =>
        fetchIfNeeded(provider.name, {
          force: options?.force,
          minIntervalMs,
        })
      )
  );
}
