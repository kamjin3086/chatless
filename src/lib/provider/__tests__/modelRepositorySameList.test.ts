import { describe, expect, it } from 'vitest';
import { defaultCacheManager } from '@/lib/cache/CacheManager';
import { modelRepository } from '@/lib/provider/ModelRepository';

describe('ModelRepository.save skips identical lists', () => {
  it('does not notify subscribers when names and labels are unchanged', async () => {
    const provider = `__test_same_list_${Date.now()}`;
    const models = [
      { provider, name: 'a', aliases: ['a'], label: 'A' },
      { provider, name: 'b', aliases: ['b'], label: 'B' },
    ] as any;

    await modelRepository.save(provider, models);

    let notifies = 0;
    const off = modelRepository.subscribeAll(() => {
      notifies += 1;
    });

    await modelRepository.save(provider, [
      { provider, name: 'a', aliases: ['a'], label: 'A' },
      { provider, name: 'b', aliases: ['b'], label: 'B' },
    ] as any);

    off();
    await defaultCacheManager.evict(`models:${provider}`);

    expect(notifies).toBe(0);
  });

  it('notifies when the model set actually changes', async () => {
    const provider = `__test_changed_list_${Date.now()}`;
    await modelRepository.save(provider, [
      { provider, name: 'a', aliases: ['a'], label: 'A' },
    ] as any);

    let notifies = 0;
    const off = modelRepository.subscribeAll(() => {
      notifies += 1;
    });

    await modelRepository.save(provider, [
      { provider, name: 'a', aliases: ['a'], label: 'A' },
      { provider, name: 'c', aliases: ['c'], label: 'C' },
    ] as any);

    off();
    await defaultCacheManager.evict(`models:${provider}`);

    expect(notifies).toBe(1);
  });
});
