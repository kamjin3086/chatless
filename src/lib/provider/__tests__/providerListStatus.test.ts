import { describe, expect, it } from 'vitest';
import {
  providerRank,
  providerStatusChip,
  sortProvidersForMobileList,
} from '@/lib/provider/providerListStatus';

describe('mobile provider list status', () => {
  it('labels rows with the same keys the detail hint uses', () => {
    // 列表和详情页两边各写一套文案的话，同一件事会有两种说法。
    expect(providerStatusChip({ lastResult: 'CONNECTED' }).labelKey).toBe(
      'provider.connection.connected',
    );
    expect(providerStatusChip({ configStatus: 'NO_KEY' }).labelKey).toBe(
      'provider.connection.noKey',
    );
    expect(providerStatusChip({ lastResult: 'NOT_CONNECTED' }).labelKey).toBe(
      'provider.connection.disconnected',
    );
    expect(providerStatusChip({ displayStatus: 'CONNECTING' }).labelKey).toBe(
      'provider.connection.checking',
    );
    // 没检过就说没检过，不要装作连不上。
    expect(providerStatusChip({}).labelKey).toBe('provider.list.unchecked');
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
