/**
 * 会话级“附加内容”状态（非持久化）
 *
 * 用于提升 Agent 体验：例如“附加工作目录”，让当前会话期间 filesystem 可在该目录及子目录工作。
 * 注意：这是临时授权，仅在应用运行期存在。
 */

import { create } from 'zustand';
import { ensureAllowlistedDirectory } from '@/lib/filesystemAllowlist';

type ConversationId = string;

interface ConversationAttachmentState {
  workingDirByConversation: Record<ConversationId, string | undefined>;

  setWorkingDir: (conversationId: string, absolutePath: string) => void;
  clearWorkingDir: (conversationId: string) => void;
  getWorkingDir: (conversationId: string) => string | undefined;
}

function normalizePath(p: string): string {
  return String(p || '').trim().replace(/\\/g, '/');
}

export const useConversationAttachmentStore = create<ConversationAttachmentState>((set, get) => ({
  workingDirByConversation: {},

  setWorkingDir: (conversationId, absolutePath) => {
    const cid = String(conversationId || '').trim();
    const p = normalizePath(absolutePath);
    if (!cid || !p) return;
    set((state) => ({
      workingDirByConversation: { ...state.workingDirByConversation, [cid]: p },
    }));

    // 自动加入 filesystem 白名单（你选择了 workdir 自动授权）
    // 注意：该目录的 alias 仍由会话注入的 @WorkDir 表达，持久化条目不强制占用 alias 名称，避免冲突。
    void ensureAllowlistedDirectory({
      path: p,
      source: 'workdir',
      permissions: { read: true, write: true, create: true, delete: false },
      reconnect: true,
    });
  },

  clearWorkingDir: (conversationId) => {
    const cid = String(conversationId || '').trim();
    if (!cid) return;
    set((state) => {
      const next = { ...state.workingDirByConversation };
      delete next[cid];
      return { workingDirByConversation: next };
    });
  },

  getWorkingDir: (conversationId) => {
    const cid = String(conversationId || '').trim();
    if (!cid) return undefined;
    return get().workingDirByConversation[cid];
  },
}));

