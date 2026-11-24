/**
 * 把 `androidLogRing` 里的现场送出手机。
 *
 * 手机没接 adb 时，日志只有离开设备才有用。三条路按可用性排：
 * 系统的分享面板（最合手，直接发到微信/文件/邮件）→ Tauri 保存对话框 → 剪贴板。
 * 三条都不通才算失败。
 */
import {
  buildLogExportText,
  flushLogRing,
  readLogRing,
} from './androidLogRing';

export type LogExportOutcome =
  | { kind: 'shared' }
  | { kind: 'cancelled' }
  | { kind: 'saved'; name: string }
  | { kind: 'clipboard' }
  | { kind: 'empty' }
  | { kind: 'failed' };

function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'AbortError'
  );
}

function fileName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `chatless-android-${stamp}.txt`;
}

export async function exportAndroidLogs(): Promise<LogExportOutcome> {
  await flushLogRing();
  if (readLogRing().length === 0) return { kind: 'empty' };

  const text = await buildLogExportText();
  const name = fileName();

  // 分享面板是手机上最直白的一条路：选个应用就发出去了。
  try {
    const file = new File([text], name, { type: 'text/plain' });
    if (
      typeof navigator !== 'undefined' &&
      navigator.canShare?.({ files: [file] })
    ) {
      await navigator.share({ files: [file], title: name });
      return { kind: 'shared' };
    }
  } catch (error) {
    // 用户按下取消，就别再拿别的弹窗去追他。
    if (isAbort(error)) return { kind: 'cancelled' };
  }

  try {
    const { downloadService } = await import('@/lib/utils/downloadService');
    if (await downloadService.downloadText(name, text))
      return { kind: 'saved', name };
  } catch {
    // 保存对话框在手机上不一定可用，下面还有剪贴板
  }

  try {
    await navigator.clipboard.writeText(text);
    return { kind: 'clipboard' };
  } catch {
    return { kind: 'failed' };
  }
}
