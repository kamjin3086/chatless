/**
 * Opt-in request logging for the LLM layer.
 *
 * Why this exists: when a reply looked like it answered a message the user
 * never sent, there was no way to see what the app had actually put on the
 * wire. The Tauri log file only carries Rust-side lines, and the app's console
 * forwarding is disabled in production, so the chat payloads were invisible.
 *
 * How to turn it on: 设置 → 高级设置 → 日志级别 → 调试 ("debug"). The Rust log
 * target is raised to `debug` at the same time, so the dumps land in
 * `~/Library/Logs/com.kamjin.chatless/logs.log` (and in the console).
 * `NEXT_PUBLIC_LLM_DEBUG=true` at build time enables it unconditionally.
 *
 * Payloads contain the user's own conversation text - that is the point - so
 * the switch stays off by default and the dump is truncated.
 */

import { debug as logDebug, warn as logWarn } from '@tauri-apps/plugin-log';
import { logger } from '@/lib/logger';

const MAX_DUMP_CHARS = 20000;

export function isLlmDebugEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_LLM_DEBUG === 'true') return true;
  try {
    return logger.getLogLevel() === 'debug';
  } catch {
    return false;
  }
}

function truncate(text: string, max: number = MAX_DUMP_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}… (+${text.length - max} chars)` : text;
}

function write(level: 'debug' | 'warn', message: string): void {
  try {
    if (level === 'warn') console.warn(message);
    else console.debug(message);
  } catch {
    /* console always exists; nothing sensible to do here */
  }
  try {
    const send = level === 'warn' ? logWarn : logDebug;
    void send(message).catch(() => {
      /* not running under Tauri (tests, browser) */
    });
  } catch {
    /* not running under Tauri (tests, browser) */
  }
}

function pretty(value: unknown): string {
  try {
    return truncate(JSON.stringify(value, null, 2));
  } catch {
    return truncate(String(value));
  }
}

export function dumpLlmRequest(info: {
  provider: string;
  model: string;
  url?: string;
  body: unknown;
}): void {
  if (!isLlmDebugEnabled()) return;
  write(
    'debug',
    `[llm-debug] request provider=${info.provider} model=${info.model}${info.url ? ` url=${info.url}` : ''}\n${pretty(info.body)}`,
  );
}

/**
 * A turn boundary in the model's own output. This is always logged: it means
 * the upstream server handed back raw template text, so part of the model's
 * continuation was dropped instead of being rendered as the answer.
 */
export function reportTurnBoundary(info: {
  provider: string;
  model: string;
  droppedChars: number;
}): void {
  write(
    'warn',
    `[llm] upstream model emitted a chat-template turn boundary; dropped ${info.droppedChars} char(s) of continuation ` +
      `(provider=${info.provider} model=${info.model}). This usually means the server ignored the chat template ` +
      `or the request's stop sequences are unset.`,
  );
}
