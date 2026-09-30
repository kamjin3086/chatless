export type ConnectionHintStatus =
  | 'CONNECTING'
  | 'CONNECTED'
  | 'NOT_CONNECTED'
  | 'NO_KEY'
  | 'NO_FETCHER';

export function resolveConnectionHintStatus(
  isConnecting: boolean,
  provider: {
    configStatus?: string | null;
    lastResult?: string | null;
  }
): ConnectionHintStatus | null {
  // 检测中只看进行中标记。检测一旦结束，必须立刻展示结果，不能再用时间戳卡住「正在检测」。
  if (isConnecting) return 'CONNECTING';
  if (provider.configStatus === 'NO_KEY') return 'NO_KEY';
  if (provider.lastResult === 'CONNECTED') return 'CONNECTED';
  if (provider.lastResult === 'NOT_CONNECTED') return 'NOT_CONNECTED';
  if (provider.configStatus === 'NO_FETCHER') return 'NO_FETCHER';
  return null;
}
