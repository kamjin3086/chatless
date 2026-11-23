/**
 * 手机上「管理模型」列表的状态口径。
 *
 * 状态本身走 `resolveConnectionHintStatus`，标签用详情页那块连接提示同一批翻译键：
 * 列表说「连接正常」、点进去写「无法连接」，用户只会认为其中一边在骗他。
 */
import type { TranslationKey } from '@/i18n/types';
import { resolveConnectionHintStatus } from '@/lib/provider/connectionHintStatus';

type StatusProvider = {
  configStatus?: string | null;
  lastResult?: string | null;
  displayStatus?: string | null;
};

/** 状态 →（翻译键, 圆点颜色）。翻译键而不是文案：换个语言两边还得一起变。 */
const STATUS_META: Record<string, { labelKey: TranslationKey; dot: string }> = {
  CONNECTED: { labelKey: 'provider.connection.connected', dot: 'bg-green-500' },
  CONNECTING: { labelKey: 'provider.connection.checking', dot: 'bg-blue-500' },
  NO_KEY: { labelKey: 'provider.connection.noKey', dot: 'bg-amber-500' },
  NOT_CONNECTED: {
    labelKey: 'provider.connection.disconnected',
    dot: 'bg-red-500',
  },
  NO_FETCHER: {
    labelKey: 'provider.connection.noFetcher',
    dot: 'bg-slate-400',
  },
};

/** 没检过就说没检过，不要装作连不上。 */
const UNCHECKED: { labelKey: TranslationKey; dot: string } = {
  labelKey: 'provider.list.unchecked',
  dot: 'bg-slate-400',
};

function statusOf(provider: StatusProvider): string | undefined {
  if (provider.displayStatus === 'CONNECTING') return 'CONNECTING';
  return resolveConnectionHintStatus(false, provider) ?? undefined;
}

export function providerStatusChip(provider: StatusProvider): {
  labelKey: TranslationKey;
  dot: string;
} {
  const status = statusOf(provider);
  return (status && STATUS_META[status]) || UNCHECKED;
}

/** 能用的排前面：使用中第一，连得上次之，没密钥、连不上、没检查过的垫底。 */
const STATUS_RANK: Record<string, number> = {
  CONNECTED: 0,
  CONNECTING: 1,
  NO_KEY: 2,
  NOT_CONNECTED: 3,
  NO_FETCHER: 4,
};

export function providerRank(
  provider: StatusProvider,
  name: string,
  inUseProviderName: string | null,
): number {
  if (name === inUseProviderName) return -1;
  const status = statusOf(provider);
  return status ? (STATUS_RANK[status] ?? 5) : 5;
}

/** 排序时同档要保持用户自己的顺序，所以用稳定的 `sort`（JS 的 sort 是稳定的）。 */
export function sortProvidersForMobileList<
  T extends StatusProvider & { name: string },
>(providers: T[], inUseProviderName: string | null): T[] {
  return [...providers].sort(
    (a, b) =>
      providerRank(a, a.name, inUseProviderName) -
      providerRank(b, b.name, inUseProviderName),
  );
}
