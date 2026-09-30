"use client";

import { create } from "zustand";

interface UiSessionState {
  /** 本次应用会话内，聊天输入框的手动高度（px）。null 表示未手动设置，走自动自适应 */
  chatInputHeight: number | null;
  setChatInputHeight: (h: number | null) => void;
  /** 仅规划开关属于当前会话 UI 状态，发送后保持，运行期间由输入组件锁定。 */
  planOnly: boolean;
  planOnlyByConversation: Record<string, boolean>;
  setPlanOnly: (enabled: boolean, conversationId?: string | null) => void;
  getPlanOnly: (conversationId?: string | null) => boolean;
}

export const useUiSession = create<UiSessionState>((set, get) => ({
  chatInputHeight: null,
  setChatInputHeight: (h) => set({ chatInputHeight: typeof h === 'number' ? Math.max(0, h) : null }),
  planOnly: false,
  planOnlyByConversation: {},
  setPlanOnly: (enabled, conversationId) => set((state) => {
    const value = Boolean(enabled);
    if (!conversationId) return { planOnly: value };
    return {
      planOnly: value,
      planOnlyByConversation: { ...state.planOnlyByConversation, [conversationId]: value },
    };
  }),
  getPlanOnly: (conversationId): boolean => {
    const state = get();
    return conversationId
      ? Boolean(state.planOnlyByConversation[conversationId])
      : state.planOnly;
  },
}));


