import { useChatStore } from '@/store/chatStore';

export const IDLE_GENERATION_MS = 120_000;
export const IDLE_CHECK_INTERVAL_MS = 5_000;

/** 是否存在 running / pending_auth 的工具卡（工具阶段不应触发空闲超时） */
export function hasBlockingToolCards(conversationId: string | null | undefined): boolean {
  if (!conversationId) return false;
  try {
    const state = useChatStore.getState();
    const conv: any = state.conversations.find((c: any) => c.id === conversationId);
    const msgs: any[] = Array.isArray(conv?.messages) ? conv.messages : [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m: any = msgs[i];
      if (!m || m.role !== 'assistant') continue;
      const rawSegs: any[] = Array.isArray(m.segments) ? m.segments : [];
      const vmItems: any[] = Array.isArray(m.segments_vm?.items) ? m.segments_vm.items : [];
      const segs = rawSegs.length > 0 ? rawSegs : vmItems;
      for (const s of segs) {
        if (s?.kind === 'toolCard' && (s.status === 'running' || s.status === 'pending_auth')) {
          return true;
        }
      }
    }
  } catch {
    // ignore
  }
  return false;
}

export type IdleGenerationWatchHandle = {
  stop: () => void;
};

export function startIdleGenerationWatch(params: {
  conversationId: string | null;
  getLastActivityMs: () => number;
  onIdle: () => void;
}): IdleGenerationWatchHandle {
  const id = setInterval(() => {
    if (hasBlockingToolCards(params.conversationId)) return;
    if (Date.now() - params.getLastActivityMs() > IDLE_GENERATION_MS) {
      params.onIdle();
    }
  }, IDLE_CHECK_INTERVAL_MS);
  return {
    stop: () => clearInterval(id),
  };
}
