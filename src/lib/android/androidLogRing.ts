/**
 * 手机上的日志环。
 *
 * Android 版没给 `tauri-plugin-log` 配文件目标，`console` 全进 logcat，而用户的手机
 * 不接 adb，那些日志就等于没产生。这里在 WebView 里留一份内存副本（崩溃重启前落到
 * 存储里一份尾部），配合「管理模型」右下角的导出按钮把现场带出来。
 */
import StorageUtil from '@/lib/storage';

export type LogRingEntry = {
  /** 毫秒时间戳 */
  t: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  text: string;
};

/** 内存里留多少条。再大意义不大：一次复现的现场用不了这么多。 */
const MAX_ENTRIES = 1500;
/** 单条上限，防止某个 dump 把整环挤掉。 */
const MAX_TEXT = 800;
/** 落盘只留尾部这些条，别让存储表被日志撑大。 */
const PERSIST_ENTRIES = 400;
const PERSIST_BUDGET = 220_000;
const PERSIST_KEY = 'android_log_ring';
/** 攒够这么多条再写一次盘，避免每条日志一次 SQL。 */
const FLUSH_EVERY = 50;

const buffer: LogRingEntry[] = [];
let installed = false;
let sinceFlush = 0;
let dropped = 0;

function push(level: LogRingEntry['level'], text: string): void {
  const clean = typeof text === 'string' ? text : String(text);
  buffer.push({
    t: Date.now(),
    level,
    text: clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT)}…` : clean,
  });
  while (buffer.length > MAX_ENTRIES) {
    buffer.shift();
    dropped += 1;
  }
  if (++sinceFlush >= FLUSH_EVERY) {
    sinceFlush = 0;
    void flushLogRing();
  }
}

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.message}\n${arg.stack ?? ''}`;
  try {
    return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
  } catch {
    return String(arg);
  }
}

function joinArgs(args: unknown[]): string {
  return args.map(formatArg).join(' ');
}

function rememberStoredTail(): void {
  void StorageUtil.getItem<LogRingEntry[]>(PERSIST_KEY)
    .then((stored) => {
      if (!Array.isArray(stored) || stored.length === 0) return;
      // 盘上的那次是重启前的现场，排在本次会话前面。
      const head = stored.filter(
        (e) => e && typeof e.t === 'number' && typeof e.text === 'string',
      );
      buffer.unshift(...head);
      while (buffer.length > MAX_ENTRIES) buffer.shift();
    })
    .catch(() => {
      // 读不到旧日志不算事，本次会话的日志照样能导。
    });
}

/** 把内存环的尾部写进存储；串行排队，最后调的那次必定是最新现场。 */
let flushQueue: Promise<void> = Promise.resolve();

export function flushLogRing(): Promise<void> {
  flushQueue = flushQueue.then(writeTail, writeTail);
  return flushQueue;
}

async function writeTail(): Promise<void> {
  try {
    const tail = buffer.slice(-PERSIST_ENTRIES);
    // 从最旧的开始丢，直到落进预算；至少留最后一条。
    let size = tail.reduce((n, e) => n + e.text.length, 0);
    while (tail.length > 1 && size > PERSIST_BUDGET) {
      size -= tail.shift()!.text.length;
    }
    await StorageUtil.setItem(PERSIST_KEY, tail);
  } catch {
    // 落盘失败：内存里的日志还在，导出照常。
  }
}

/**
 * 装一次就好：包住 `console`、未捕获错误和未处理的 rejection。
 * 只应在 Android 运行时调用（现在由 `ChatLayoutClient` 在挂载时装上）。
 */
export function installAndroidLogRing(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const wrap = (
    name: 'log' | 'debug' | 'info' | 'warn' | 'error',
    level: LogRingEntry['level'],
  ) => {
    const original = console[name].bind(console);
    console[name] = (...args: unknown[]) => {
      original(...args);
      try {
        push(level, joinArgs(args));
      } catch {
        // 记日志这件事本身不该把调用者拖下水
      }
    };
  };
  wrap('debug', 'debug');
  wrap('log', 'info');
  wrap('info', 'info');
  wrap('warn', 'warn');
  wrap('error', 'error');

  window.addEventListener('error', (event) => {
    push(
      'error',
      `[window.onerror] ${event.message} @ ${event.filename ?? '?'}:${event.lineno ?? '?'}\n${event.error?.stack ?? ''}`,
    );
  });
  window.addEventListener('unhandledrejection', (event) => {
    push('error', `[unhandledrejection] ${formatArg(event.reason)}`);
  });

  // 手机上进后台或被系统杀掉前留一份，崩溃现场才不会只活在内存里。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushLogRing();
  });
  window.addEventListener('pagehide', () => {
    void flushLogRing();
  });

  rememberStoredTail();
  push('info', `[logring] 已接管控制台，级别 debug`);
}

export function readLogRing(): LogRingEntry[] {
  return buffer.slice();
}

function stamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function timeForHeader(): string {
  return stamp(Date.now());
}

/** 版本、设备、当前会话、各家服务的状态——导出文件里没有这些就等于没上下文。 */
async function buildHeader(): Promise<string[]> {
  const lines: string[] = [`Chatless Android 日志导出 @ ${timeForHeader()}`];
  try {
    const { getVersionInfo } = await import('@/config/app-info');
    const { version, build } = getVersionInfo();
    lines.push(`version: ${version} (build ${build})`);
  } catch {
    // 拿不到版本也要往下走
  }
  try {
    const os = await import('@tauri-apps/plugin-os');
    // Android 上 `version()` 只给“Unknown”、`type()` 和 `platform()` 重复；具体版本看下面的 UA。
    lines.push(`platform: ${os.platform()} · arch ${os.arch()}`);
  } catch {
    // 插件不可用（测试环境、浏览器里跑）：靠下面的 UA 认设备
  }
  lines.push(
    `userAgent: ${typeof navigator === 'undefined' ? '?' : navigator.userAgent}`,
  );
  try {
    const { useChatStore } = await import('@/store/chatStore');
    const s = useChatStore.getState() as any;
    const conv = s.currentConversationId
      ? (s.conversations ?? []).find(
          (c: any) => c.id === s.currentConversationId,
        )
      : null;
    lines.push(
      `conversation: ${s.currentConversationId ?? 'none'} · model ${conv?.model_provider ?? 'unknown'}/${conv?.model_id ?? '?'} · messages ${(conv?.messages ?? []).length}`,
    );
  } catch {
    // 存储还没就绪时没有会话可报
  }
  try {
    const { useProviderMetaStore } = await import('@/store/providerMetaStore');
    const list = (useProviderMetaStore.getState() as any).list ?? [];
    lines.push(
      `providers: ${
        list
          .map((p: any) => `${p.name}(${(p.models ?? []).length})`)
          .join(', ') || 'none'
      }`,
    );
  } catch {
    // 同上
  }
  lines.push(`buffered: ${buffer.length} 条（已丢弃更早的 ${dropped} 条）`);
  return lines;
}

/** 生成导出正文：头部 + 按时间排序的日志行。 */
export async function buildLogExportText(): Promise<string> {
  const header = await buildHeader();
  const body = buffer
    .slice()
    .sort((a, b) => a.t - b.t)
    .map((e) => `[${stamp(e.t)}] ${e.level.toUpperCase().padEnd(5)} ${e.text}`)
    .join('\n');
  return `${header.join('\n')}\n----- log -----\n${body}\n`;
}
