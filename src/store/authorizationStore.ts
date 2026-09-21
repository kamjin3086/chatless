/**
 * MCP工具调用授权状态管理
 */

import { create } from 'zustand';

/**
 * How long an approval should last.
 * - `once`: this call only (the default)
 * - `always`: adds the directory to the persistent allowlist
 * - `unrestricted`: no more filesystem prompts in this conversation
 */
export type ApprovalDecision = 'once' | 'always' | 'unrestricted';

export interface PendingFilesystemScope {
  /** Operation the user is approving: read / write / create / delete. */
  op: string;
  /** Resolved absolute path of the target. */
  path: string;
  /** Directory the grant would cover. */
  directory: string;
}

export interface PendingAuthorization {
  id: string; // 唯一ID
  messageId: string;
  /** Conversation the call belongs to (used by the card's undo action). */
  conversationId?: string;
  server: string;
  tool: string;
  args?: Record<string, unknown>;
  /** Present for filesystem calls so the card can offer directory-level grants. */
  filesystem?: PendingFilesystemScope;
  createdAt: number;
  // 授权决策回调
  onApprove: (decision: ApprovalDecision) => void;
  onReject: () => void;
}

interface AuthorizationState {
  pendingAuthorizations: Map<string, PendingAuthorization>;
  // 添加待授权请求
  addPendingAuthorization: (auth: PendingAuthorization) => void;
  
  // 批准授权（可指定授权时长）
  approveAuthorization: (id: string, decision?: ApprovalDecision) => boolean;
  
  // 拒绝授权
  rejectAuthorization: (id: string) => boolean;

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
  addPendingAuthorization: (auth) => {
    set((state) => {
      const newMap = new Map(state.pendingAuthorizations);
      newMap.set(auth.id, auth);
      return { pendingAuthorizations: newMap };
    });
  },
  
  approveAuthorization: (id, decision = 'once') => {
    const auth = get().getPendingAuthorization(id);
    if (auth) {
      auth.onApprove(decision);
      get().removeAuthorization(id);
      return true;
    }
    return false;
  },
  
  rejectAuthorization: (id) => {
    const auth = get().getPendingAuthorization(id);
    if (auth) {
      auth.onReject();
      get().removeAuthorization(id);
      return true;
    }
    return false;
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

