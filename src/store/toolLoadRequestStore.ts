/**
 * 工具加载请求 Store
 * 
 * 管理 AI 主动请求加载的工具组
 */

import { create } from 'zustand';
import type { ToolGroupId } from '@/lib/mcp/nativeTools/toolRegistry';

interface ToolLoadRequestState {
  /** AI 主动请求加载的工具组 */
  requestedGroups: ToolGroupId[];
  
  /** 当前已加载的工具组（包括自动检测 + AI 请求） */
  loadedGroups: ToolGroupId[];
  
  /** 会话 ID（用于重置） */
  conversationId: string | null;
  
  /** 请求加载工具组 */
  requestLoad: (groupId: ToolGroupId) => void;
  
  /** 标记工具组已加载 */
  markLoaded: (groupIds: ToolGroupId[]) => void;
  
  /** 重置（新会话时调用） */
  reset: (conversationId?: string) => void;
  
  /** 获取待加载的组（请求了但还没加载的） */
  getPendingRequests: () => ToolGroupId[];
}

export const useToolLoadRequestStore = create<ToolLoadRequestState>((set, get) => ({
  requestedGroups: [],
  loadedGroups: ['core'], // 核心组始终已加载
  conversationId: null,

  requestLoad: (groupId) => {
    const { requestedGroups, loadedGroups } = get();
    // 如果已经请求过或已加载，忽略
    if (requestedGroups.includes(groupId) || loadedGroups.includes(groupId)) {
      return;
    }
    set({ requestedGroups: [...requestedGroups, groupId] });
  },

  markLoaded: (groupIds) => {
    const { loadedGroups } = get();
    const newLoaded = [...new Set([...loadedGroups, ...groupIds])];
    set({ loadedGroups: newLoaded });
  },

  reset: (conversationId) => {
    set({
      requestedGroups: [],
      loadedGroups: ['core'],
      conversationId: conversationId || null,
    });
  },

  getPendingRequests: () => {
    const { requestedGroups, loadedGroups } = get();
    return requestedGroups.filter(g => !loadedGroups.includes(g));
  },
}));
