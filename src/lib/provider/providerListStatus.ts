/**
 * 手机上「管理模型」列表的状态口径。
 *
 * 状态本身走 `resolveConnectionHintStatus`，和详情页里那块连接提示是同一份判定：
 * 列表说「已连接」、点进去写「无法连接」，用户只会认为其中一边在骗他。
 */
import { resolveConnectionHintStatus } from '@/lib/provider/connectionHintStatus';

type StatusProvider = {
  configStatus?: string | null;
  lastResult?: string | null;
  displayStatus?: string | null;
};

const CHIPS: Record<string, { label: string; dot: string }> = {
  CONNECTED: { label: '已连接', dot: 'bg-green-500' },
  CONNECTING: { label: '检测中', dot: 'bg-blue-500' },
  NO_KEY: { label: '需要密钥', dot: 'bg-amber-500' },
  NOT_CONNECTED: { label: '无法连接', dot: 'bg-red-500' },
  NO_FETCHER: { label: '无法拉取模型', dot: 'bg-slate-400' },
  UNKNOWN: { label: '未检查', dot: 'bg-slate-400' },
};

function statusOf(provider: StatusProvider): string {
  if (provider.displayStatus === 'CONNECTING') return 'CONNECTING';
  return (
    resolveConnectionHintStatus(
      provider.displayStatus === 'CONNECTING',
      provider,
    ) ?? 'UNKNOWN'
  );
}

export function providerStatusChip(provider: StatusProvider): {
  label: string;
  dot: string;
} {
  return CHIPS[statusOf(provider)] ?? CHIPS.UNKNOWN;
}

/** 能用的排前面：使用中第一，连得上次之，没密钥、连不上、没检查过的垫底。 */
const STATUS_RANK: Record<string, number> = {
  CONNECTED: 0,
  CONNECTING: 1,
  NO_KEY: 2,
  NOT_CONNECTED: 3,
  NO_FETCHER: 4,
  UNKNOWN: 5,
};

export function providerRank(
  provider: StatusProvider,
  name: string,
  inUseProviderName: string | null,
): number {
  if (name === inUseProviderName) return -1;
  return STATUS_RANK[statusOf(provider)] ?? 5;
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
