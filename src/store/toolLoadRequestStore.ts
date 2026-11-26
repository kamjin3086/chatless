/**
 * 工具加载请求 Store。
 * 工具发现属于会话状态，不能由一个跨会话的全局 loadedGroups 决定。
 */

import { create } from 'zustand';

// 组 id 已不再限于静态 union（内置扩展贡献也往这里写），集合层面用 string。
type LoadedGroupId = string;

interface SessionLoadState {
  requestedGroups: LoadedGroupId[];
  loadedGroups: LoadedGroupId[];
  loadedMcpServers: string[];
}

interface ToolLoadRequestState {
  sessions: Record<string, SessionLoadState>;
  requestLoad: (groupId: LoadedGroupId, conversationId?: string) => void;
  markLoaded: (groupIds: LoadedGroupId[], conversationId?: string) => void;
  loadMcpServer: (server: string, conversationId?: string) => void;
  reset: (conversationId?: string) => void;
  getPendingRequests: (conversationId?: string) => LoadedGroupId[];
  getLoadedMcpServers: (conversationId?: string) => string[];
}

const emptySession = (): SessionLoadState => ({ requestedGroups: [], loadedGroups: ['core'], loadedMcpServers: [] });
const sessionKey = (id?: string | null): string => String(id || '__default__');

export const useToolLoadRequestStore = create<ToolLoadRequestState>((set, get) => ({
  sessions: {},

  requestLoad: (groupId, conversationId) => {
    const key = sessionKey(conversationId);
    const current = get().sessions[key] || emptySession();
    if (current.requestedGroups.includes(groupId) || current.loadedGroups.includes(groupId)) return;
    const next = { ...current, requestedGroups: [...current.requestedGroups, groupId] };
    set((state) => ({
      sessions: { ...state.sessions, [key]: next },
    }));
  },

  markLoaded: (groupIds, conversationId) => {
    const key = sessionKey(conversationId);
    const current = get().sessions[key] || emptySession();
    const next = {
      requestedGroups: current.requestedGroups,
      loadedGroups: [...new Set([...current.loadedGroups, ...groupIds])],
      loadedMcpServers: current.loadedMcpServers,
    };
    set((state) => ({
      sessions: { ...state.sessions, [key]: next },
    }));
  },

  loadMcpServer: (server, conversationId) => {
    const key = sessionKey(conversationId);
    const current = get().sessions[key] || emptySession();
    const normalized = String(server || '').trim();
    if (!normalized || current.loadedMcpServers.includes(normalized)) return;
    const next = { ...current, loadedMcpServers: [...current.loadedMcpServers, normalized] };
    set((state) => ({ sessions: { ...state.sessions, [key]: next } }));
  },

  reset: (conversationId) => {
    const key = sessionKey(conversationId);
    const next = emptySession();
    set((state) => ({
      sessions: { ...state.sessions, [key]: next },
    }));
  },

  getPendingRequests: (conversationId) => {
    const current = get().sessions[sessionKey(conversationId)] || emptySession();
    return current.requestedGroups.filter((group) => !current.loadedGroups.includes(group));
  },

  getLoadedMcpServers: (conversationId) => {
    const current = get().sessions[sessionKey(conversationId)] || emptySession();
    return current.loadedMcpServers;
  },
}));
