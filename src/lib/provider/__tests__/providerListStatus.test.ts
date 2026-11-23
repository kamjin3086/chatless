import { describe, expect, it } from 'vitest';
import {
  providerRank,
  providerStatusChip,
  sortProvidersForMobileList,
} from '@/lib/provider/providerListStatus';

describe('mobile provider list status', () => {
  it('uses the same verdict the detail page shows', () => {
    expect(providerStatusChip({ lastResult: 'CONNECTED' }).label).toBe(
      '已连接',
    );
    expect(providerStatusChip({ configStatus: 'NO_KEY' }).label).toBe(
      '需要密钥',
    );
    expect(providerStatusChip({ lastResult: 'NOT_CONNECTED' }).label).toBe(
      '无法连接',
    );
    expect(providerStatusChip({ displayStatus: 'CONNECTING' }).label).toBe(
      '检测中',
    );
    // 没检过就说没检过，不要装作连不上。
    expect(providerStatusChip({}).label).toBe('未检查');
  });

  it('puts the provider in use first, then the ones that work', () => {
    const providers = [
      { name: 'lmstudio', lastResult: 'NOT_CONNECTED' as const },
      { name: 'local', lastResult: 'CONNECTED' as const },
      { name: 'cloud', configStatus: 'NO_KEY' as const },
      { name: 'phone', lastResult: 'CONNECTED' as const },
    ];
    expect(
      sortProvidersForMobileList(providers, 'lmstudio').map((p) => p.name),
    ).toEqual(['lmstudio', 'local', 'phone', 'cloud']);
    expect(
      sortProvidersForMobileList(providers, null).map((p) => p.name),
    ).toEqual(['local', 'phone', 'cloud', 'lmstudio']);
  });

  it('keeps the user order inside a rank', () => {
    const providers = [
      { name: 'b', lastResult: 'CONNECTED' as const },
      { name: 'a', lastResult: 'CONNECTED' as const },
    ];
    expect(
      sortProvidersForMobileList(providers, null).map((p) => p.name),
    ).toEqual(['b', 'a']);
  });

  it('ranks an unchecked provider below a working one', () => {
    const working = { name: 'x', lastResult: 'CONNECTED' as const };
    const fresh: { name: string; lastResult?: string } = { name: 'y' };
    expect(providerRank(working, 'x', null)).toBeLessThan(
      providerRank(fresh, 'y', null),
    );
    expect(providerRank(fresh, 'y', 'y')).toBe(-1);
  });
});
