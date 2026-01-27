/**
 * MCP工具调用授权状态管理
 */

import { create } from 'zustand';

export interface PendingAuthorization {
  id: string; // 唯一ID
  messageId: string;
  server: string;
  tool: string;
  args?: Record<string, unknown>;
  createdAt: number;
  // 授权决策回调
  onApprove: () => void;
  onReject: () => void;
}

interface AuthorizationState {
  pendingAuthorizations: Map<string, PendingAuthorization>;
  /**
   * “预先批准/拒绝”缓存：
   * 用于处理 UI 中点击发生在 pending 授权尚未入 store 的竞态（以及恢复/残留卡片的场景）。
   */
  _preDecision: Map<string, { decision: 'approve' | 'reject'; at: number }>;
  
  // 添加待授权请求
  addPendingAuthorization: (auth: PendingAuthorization) => void;
  
  // 批准授权
  approveAuthorization: (id: string) => boolean;
  
  // 拒绝授权
  rejectAuthorization: (id: string) => boolean;

  // 预先批准/拒绝（用于竞态/恢复）
  preApproveAuthorization: (id: string) => void;
  preRejectAuthorization: (id: string) => void;
  
  // 移除授权请求（用于清理）
  removeAuthorization: (id: string) => void;
  
  // 获取待授权请求
  getPendingAuthorization: (id: string) => PendingAuthorization | undefined;
  
  // 检查是否有待授权请求
  hasPendingAuthorization: (id: string) => boolean;

  // 按 messageId 批量拒绝（用于 stop/取消链路）
  rejectAuthorizationsByMessageId: (messageId: string) => void;
}

export const useAuthorizationStore = create<AuthorizationState>((set, get) => ({
  pendingAuthorizations: new Map(),
  _preDecision: new Map(),
  
  addPendingAuthorization: (auth) => {
    // 如果 UI 提前点了“批准/拒绝”，在这里直接消费该决定并继续执行
    const pre = get()._preDecision.get(auth.id);
    if (pre) {
      // 仅保留短时间窗口，避免陈旧点击造成误触发
      if (Date.now() - pre.at < 30_000) {
        try {
          if (pre.decision === 'approve') auth.onApprove();
          else auth.onReject();
        } catch {
          // ignore
        }
        set((state) => {
          const nextPre = new Map(state._preDecision);
          nextPre.delete(auth.id);
          return { _preDecision: nextPre };
        });
        return;
      }
      // 过期则清理
      set((state) => {
        const nextPre = new Map(state._preDecision);
        nextPre.delete(auth.id);
        return { _preDecision: nextPre };
      });
    }

    set((state) => {
      const newMap = new Map(state.pendingAuthorizations);
      newMap.set(auth.id, auth);
      return { pendingAuthorizations: newMap };
    });
  },
  
  approveAuthorization: (id) => {
    const auth = get().getPendingAuthorization(id);
    if (auth) {
      auth.onApprove();
      get().removeAuthorization(id);
      return true;
    }
    // 没有 pending：记录“预批准”，避免竞态导致点击无效
    get().preApproveAuthorization(id);
    return false;
  },
  
  rejectAuthorization: (id) => {
    const auth = get().getPendingAuthorization(id);
    if (auth) {
      auth.onReject();
      get().removeAuthorization(id);
      return true;
    }
    get().preRejectAuthorization(id);
    return false;
  },

  preApproveAuthorization: (id) => {
    const k = String(id || '').trim();
    if (!k) return;
    set((state) => {
      const next = new Map(state._preDecision);
      next.set(k, { decision: 'approve', at: Date.now() });
      return { _preDecision: next };
    });
  },

  preRejectAuthorization: (id) => {
    const k = String(id || '').trim();
    if (!k) return;
    set((state) => {
      const next = new Map(state._preDecision);
      next.set(k, { decision: 'reject', at: Date.now() });
      return { _preDecision: next };
    });
  },
  
  removeAuthorization: (id) => {
    set((state) => {
      const newMap = new Map(state.pendingAuthorizations);
      newMap.delete(id);
      return { pendingAuthorizations: newMap };
    });
  },
  
  getPendingAuthorization: (id) => {
    return get().pendingAuthorizations.get(id);
  },
  
  hasPendingAuthorization: (id) => {
    return get().pendingAuthorizations.has(id);
  },

  rejectAuthorizationsByMessageId: (messageId) => {
    const mids = String(messageId || '').trim();
    if (!mids) return;

    const toReject: PendingAuthorization[] = [];
    for (const auth of get().pendingAuthorizations.values()) {
      if (auth?.messageId === mids) toReject.push(auth);
    }
    if (toReject.length === 0) return;

    // 先回调，再一次性清理，避免回调中再次读写造成迭代问题
    for (const auth of toReject) {
      try {
        auth.onReject();
      } catch {
        // ignore
      }
    }
    set((state) => {
      const newMap = new Map(state.pendingAuthorizations);
      for (const auth of toReject) newMap.delete(auth.id);
      return { pendingAuthorizations: newMap };
    });
  },
}));

