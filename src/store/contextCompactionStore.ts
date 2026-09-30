/**
 * 历史压缩提示（进程内，不持久化）。
 *
 * 压缩是隐式发生的：模型侧突然"忘事"时，用户没法判断是被压缩了还是模型本身的问题。
 * 这里只记录"这条助手消息用到了一份历史摘要"，由消息列表里的小标记展开查看。
 * 摘要本身已经存在运行检查点里，这里不再另存一份持久副本。
 */

import { create } from 'zustand';

export type ContextCompactionNotice = {
  messageId: string;
  conversationId: string;
  /** 被摘要覆盖的历史条数。 */
  coveredMessages: number;
  summary: string;
  /** 复用已有摘要（跨轮续写）而不是本轮新生成。 */
  reused: boolean;
  at: number;
};

interface ContextCompactionState {
  notices: Record<string, ContextCompactionNotice>;
  setNotice: (notice: ContextCompactionNotice) => void;
  clearNotice: (messageId: string) => void;
}

/** 进程内只保留最近这些条，避免长期运行无限增长。 */
const MAX_NOTICES = 50;

export const useContextCompactionStore = create<ContextCompactionState>()((set) => ({
  notices: {},
  setNotice: (notice) => {
    const messageId = String(notice?.messageId || '').trim();
    if (!messageId) return;
    set((state) => {
      const next = { ...state.notices, [messageId]: notice };
      const ids = Object.keys(next);
      if (ids.length > MAX_NOTICES) {
        ids
          .sort((a, b) => (next[a]?.at || 0) - (next[b]?.at || 0))
          .slice(0, ids.length - MAX_NOTICES)
          .forEach((id) => delete next[id]);
      }
      return { notices: next };
    });
  },
  clearNotice: (messageId) => {
    const key = String(messageId || '').trim();
    if (!key) return;
    set((state) => {
      const next = { ...state.notices };
      delete next[key];
      return { notices: next };
    });
  },
}));
