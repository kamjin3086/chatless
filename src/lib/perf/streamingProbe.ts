/**
 * 流式渲染性能探针（仅开发环境）。
 *
 * 目的：把"感觉卡"变成可比较的数字。测量的都是流式渲染真正关心的量：
 *  - conversations 写入次数（每写一次就会让聊天页/侧边栏参与重渲染）
 *  - 主线程长任务（>50ms）
 *  - 帧间隔 P50 / P95
 *  - 首字上屏（流开始 → 第一次带内容的帧）
 *  - 吞吐（token/秒）
 *
 * 用法（开发模式）：控制台执行 `__chatlessPerf.runFixture()`，
 * 结束后自动打印 summary；也可 `start()/stop()/summary()/reset()` 手动控制。
 */

import { useChatStore } from '@/store/chatStore';
import { createContentAppender } from '@/lib/chat/stream/ContentAppender';
import { buildStreamFixture, type StreamFixtureChunk } from './streamFixture';

export type StreamingProbeSummary = {
  active: boolean;
  durationMs: number;
  storeWrites: number;
  storeWritesPerSecond: number;
  longTasks: number;
  longestTaskMs: number;
  frameCount: number;
  frameP50Ms: number;
  frameP95Ms: number;
  firstContentFrameMs: number | null;
  chunks: number;
  chunksPerSecond: number;
};

type ProbeState = {
  startedAt: number;
  active: boolean;
  storeWrites: number;
  longTasks: number;
  longestTaskMs: number;
  frames: number[];
  lastFrameAt: number;
  firstContentFrameMs: number | null;
  chunks: number;
  observer: PerformanceObserver | null;
  rafId: number | null;
  unsubscribeStore: (() => void) | null;
};

const state: ProbeState = {
  startedAt: 0,
  active: false,
  storeWrites: 0,
  longTasks: 0,
  longestTaskMs: 0,
  frames: [],
  lastFrameAt: 0,
  firstContentFrameMs: null,
  chunks: 0,
  observer: null,
  rafId: null,
  unsubscribeStore: null,
};

const LONG_TASK_MS = 50;

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return Math.round(sorted[index] * 100) / 100;
}

function reset() {
  state.startedAt = 0;
  state.active = false;
  state.storeWrites = 0;
  state.longTasks = 0;
  state.longestTaskMs = 0;
  state.frames = [];
  state.lastFrameAt = 0;
  state.firstContentFrameMs = null;
  state.chunks = 0;
}

function stop() {
  state.active = false;
  if (state.rafId !== null) {
    try { cancelAnimationFrame(state.rafId); } catch { /* noop */ }
    state.rafId = null;
  }
  try { state.observer?.disconnect(); } catch { /* noop */ }
  state.observer = null;
  state.unsubscribeStore?.();
  state.unsubscribeStore = null;
}

function start() {
  reset();
  state.active = true;
  state.startedAt = performance.now();
  state.lastFrameAt = state.startedAt;

  try {
    const supported = (PerformanceObserver as any)?.supportedEntryTypes as string[] | undefined;
    if (!supported || supported.includes('longtask')) {
      state.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > LONG_TASK_MS) {
            state.longTasks += 1;
            state.longestTaskMs = Math.max(state.longestTaskMs, entry.duration);
          }
        }
      });
      state.observer.observe({ entryTypes: ['longtask'] });
    }
  } catch {
    state.observer = null;
  }

  const tick = () => {
    if (!state.active) return;
    const now = performance.now();
    state.frames.push(now - state.lastFrameAt);
    state.lastFrameAt = now;
    state.rafId = requestAnimationFrame(tick);
  };
  state.rafId = requestAnimationFrame(tick);

  // conversations 引用一变，聊天页/侧边栏就会参与重渲染：这是核心指标。
  state.unsubscribeStore = useChatStore.subscribe((next, prev) => {
    if (!state.active) return;
    if (next.conversations !== prev.conversations) {
      state.storeWrites += 1;
      if (state.firstContentFrameMs === null) {
        state.firstContentFrameMs = performance.now() - state.startedAt;
      }
    }
  });
}

function summary(): StreamingProbeSummary {
  const durationMs = state.startedAt ? performance.now() - state.startedAt : 0;
  const seconds = durationMs / 1000;
  return {
    active: state.active,
    durationMs: Math.round(durationMs),
    storeWrites: state.storeWrites,
    storeWritesPerSecond: seconds > 0 ? Math.round((state.storeWrites / seconds) * 10) / 10 : 0,
    longTasks: state.longTasks,
    longestTaskMs: Math.round(state.longestTaskMs * 100) / 100,
    frameCount: state.frames.length,
    frameP50Ms: percentile(state.frames, 0.5),
    frameP95Ms: percentile(state.frames, 0.95),
    firstContentFrameMs: state.firstContentFrameMs === null ? null : Math.round(state.firstContentFrameMs * 100) / 100,
    chunks: state.chunks,
    chunksPerSecond: seconds > 0 ? Math.round((state.chunks / seconds) * 10) / 10 : 0,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runFixture(options?: { msPerChunk?: number }): Promise<StreamingProbeSummary> {
  const msPerChunk = Math.max(4, options?.msPerChunk ?? 16);
  const store = useChatStore.getState();
  const createdConversationId = store.currentConversationId ? null : await store.createConversation('perf fixture', 'default-model');
  const conversationId = store.currentConversationId || createdConversationId!;

  const now = Date.now();
  const assistant = await useChatStore.getState().addMessage({
    id: `perf-${now}`,
    conversation_id: conversationId,
    role: 'assistant',
    content: '',
    created_at: now,
    updated_at: now,
    status: 'loading',
  } as never);
  if (!assistant?.id) throw new Error('perf fixture: 无法创建用于测量的助手消息');

  // 走生产同款对象：同一个 ContentAppender + 同一个 FSM 派发入口。
  const appender = createContentAppender({
    assistantMessageId: assistant.id,
    initialContent: '',
    updateMessage: useChatStore.getState().updateMessage,
  });

  const chunks: StreamFixtureChunk[] = buildStreamFixture();
  start();
  try {
    for (const chunk of chunks) {
      appender.append(chunk.text);
      useChatStore.getState().dispatchMessageAction(assistant.id, { type: 'TOKEN_APPEND', chunk: chunk.text } as never);
      state.chunks += 1;
      await sleep(msPerChunk);
    }
    appender.flush();
    useChatStore.getState().dispatchMessageAction(assistant.id, { type: 'STREAM_END' } as never);
    // 让最后一帧的 flush 与一次 paint 走完再收尾。
    await sleep(64);
  } finally {
    stop();
  }
  const result = summary();

  // 清理测量产物：不把夹具消息留在用户数据里。
  try {
    await useChatStore.getState().deleteMessage(assistant.id);
  } catch { /* noop */ }
  if (createdConversationId) {
    try {
      await useChatStore.getState().deleteConversation(createdConversationId);
    } catch { /* noop */ }
  }

  return result;
}

/** 在开发环境挂到 window 上，便于控制台手工测量。 */
export function installStreamingProbe() {
  if (typeof window === 'undefined') return;
  (window as any).__chatlessPerf = {
    start,
    stop,
    reset,
    summary,
    runFixture: async (options?: { msPerChunk?: number }) => {
      const result = await runFixture(options);
      // eslint-disable-next-line no-console
      console.log('[streaming-probe]', result);
      return result;
    },
  };

  // 需要无人值守地量一次真实帧数据时：
  //   NEXT_PUBLIC_STREAM_PERF_AUTORUN=1 pnpm tauri dev
  // 结果同时写到 $APPDATA/chatless-stream-perf.json，便于外部读取。
  if (process.env.NEXT_PUBLIC_STREAM_PERF_AUTORUN === '1') {
    setTimeout(async () => {
      try {
        const result = await runFixture({ msPerChunk: 16 });
        await persistReport(result);
        // eslint-disable-next-line no-console
        console.log('[streaming-probe] autorun', result);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[streaming-probe] autorun failed', error);
      }
    }, 2500);
  }
}

async function persistReport(report: unknown) {
  try {
    const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await writeTextFile('chatless-stream-perf.json', JSON.stringify(report, null, 2), {
      baseDir: BaseDirectory.AppData,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[streaming-probe] 写入报告失败', error);
  }
}
