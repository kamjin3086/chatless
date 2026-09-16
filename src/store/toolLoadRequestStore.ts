/**
 * 工具加载请求 Store。
 * 工具发现属于会话状态，不能由一个跨会话的全局 loadedGroups 决定。
 */

import { create } from 'zustand';
import type { ToolGroupId } from '@/lib/mcp/nativeTools/toolRegistry';

interface SessionLoadState {
  requestedGroups: ToolGroupId[];
  loadedGroups: ToolGroupId[];
}

interface ToolLoadRequestState {
  /** 当前会话快照，兼容尚未传入 conversationId 的旧调用方 */
  requestedGroups: ToolGroupId[];
  loadedGroups: ToolGroupId[];
  conversationId: string | null;
  sessions: Record<string, SessionLoadState>;
  requestLoad: (groupId: ToolGroupId, conversationId?: string) => void;
  markLoaded: (groupIds: ToolGroupId[], conversationId?: string) => void;
  reset: (conversationId?: string) => void;
  getPendingRequests: (conversationId?: string) => ToolGroupId[];
}

const emptySession = (): SessionLoadState => ({ requestedGroups: [], loadedGroups: ['core'] });
const sessionKey = (id?: string | null): string => String(id || '__default__');

export const useToolLoadRequestStore = create<ToolLoadRequestState>((set, get) => ({
  requestedGroups: [],
  loadedGroups: ['core'],
  conversationId: null,
  sessions: {},

  requestLoad: (groupId, conversationId) => {
    const id = conversationId ?? get().conversationId;
    const key = sessionKey(id);
    const current = get().sessions[key] || emptySession();
    if (current.requestedGroups.includes(groupId) || current.loadedGroups.includes(groupId)) return;
    const next = { ...current, requestedGroups: [...current.requestedGroups, groupId] };
    set((state) => ({
      sessions: { ...state.sessions, [key]: next },
      conversationId: id || null,
      requestedGroups: next.requestedGroups,
      loadedGroups: next.loadedGroups,
    }));
  },

  markLoaded: (groupIds, conversationId) => {
    const id = conversationId ?? get().conversationId;
    const key = sessionKey(id);
    const current = get().sessions[key] || emptySession();
    const next = {
      requestedGroups: current.requestedGroups,
      loadedGroups: [...new Set([...current.loadedGroups, ...groupIds])],
    };
    set((state) => ({
      sessions: { ...state.sessions, [key]: next },
      conversationId: id || null,
      requestedGroups: next.requestedGroups,
      loadedGroups: next.loadedGroups,
    }));
  },

  reset: (conversationId) => {
    const id = conversationId || null;
    const key = sessionKey(id);
    const next = emptySession();
    set((state) => ({
      sessions: { ...state.sessions, [key]: next },
      conversationId: id,
      requestedGroups: next.requestedGroups,
      loadedGroups: next.loadedGroups,
    }));
  },

  getPendingRequests: (conversationId) => {
    const id = conversationId ?? get().conversationId;
    const current = get().sessions[sessionKey(id)] || emptySession();
    return current.requestedGroups.filter((group) => !current.loadedGroups.includes(group));
  },
}));
