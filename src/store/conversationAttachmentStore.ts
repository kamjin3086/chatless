/**
 * 会话级“附加内容”状态。
 *
 * 用于提升 Agent 体验：例如“附加工作目录”，让当前会话期间 filesystem 可在该目录及子目录工作。
 * 注意：这是临时授权，仅在应用运行期存在。
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ensureAllowlistedDirectory } from '@/lib/filesystemAllowlist';

type ConversationId = string;

interface ConversationAttachmentState {
  /**
   * 会话自带的产物目录（文档/Chatless/<标题>-<短ID>；旧会话沿用原应用数据目录）。
   * 没有挂载目录时它就是 @WorkDir。
   */
  sessionDirByConversation: Record<ConversationId, string | undefined>;

  /**
   * 用户手动挂载目录（通过 + 号选择）。
   * 一旦挂载，它就是该会话的 @WorkDir：相对路径与默认落点都指向这里。
   */
  mountedDirByConversation: Record<ConversationId, string | undefined>;

  /** 会话挂载的知识库（Agent knowledge_* 工具注入条件） */
  knowledgeBaseByConversation: Record<ConversationId, { id: string; name: string } | undefined>;

  setKnowledgeBase: (conversationId: string, kb: { id: string; name: string }) => void;
  clearKnowledgeBase: (conversationId: string) => void;
  getKnowledgeBase: (conversationId: string) => { id: string; name: string } | undefined;

  /** 记录会话自带的产物目录（系统自动解析，不作为用户授权） */
  setWorkingDir: (conversationId: string, absolutePath: string) => void;
  clearWorkingDir: (conversationId: string) => void;
  /** 实际生效的 @WorkDir：挂载目录优先，否则会话产物目录 */
  getWorkingDir: (conversationId: string) => string | undefined;
  /** 仅会话自带产物目录（不返回挂载目录）——应用元数据只写这里 */
  getSessionDir: (conversationId: string) => string | undefined;

  /** 设置用户手动挂载目录（显示在输入框下方） */
  setMountedDir: (conversationId: string, absolutePath: string) => void;
  clearMountedDir: (conversationId: string) => void;
  getMountedDir: (conversationId: string) => string | undefined;
}

function normalizePath(p: string): string {
  return String(p || '').trim().replace(/\\/g, '/');
}

export const useConversationAttachmentStore = create<ConversationAttachmentState>()(persist((set, get) => ({
  sessionDirByConversation: {},
  mountedDirByConversation: {},
  knowledgeBaseByConversation: {},

  setKnowledgeBase: (conversationId, kb) => {
    const cid = String(conversationId || '').trim();
    if (!cid || !kb?.id) return;
    set((state) => ({
      knowledgeBaseByConversation: { ...state.knowledgeBaseByConversation, [cid]: kb },
    }));
  },

  clearKnowledgeBase: (conversationId) => {
    const cid = String(conversationId || '').trim();
    if (!cid) return;
    set((state) => {
      const next = { ...state.knowledgeBaseByConversation };
      delete next[cid];
      return { knowledgeBaseByConversation: next };
    });
  },

  getKnowledgeBase: (conversationId) => {
    const cid = String(conversationId || '').trim();
    if (!cid) return undefined;
    return get().knowledgeBaseByConversation[cid];
  },


  setWorkingDir: (conversationId, absolutePath) => {
    const cid = String(conversationId || '').trim();
    const p = normalizePath(absolutePath);
    if (!cid || !p) return;
    set((state) => ({
      sessionDirByConversation: { ...state.sessionDirByConversation, [cid]: p },
    }));
    // 会话产物目录不写入持久白名单：运行期由流水线合成的 @WorkDir 条目 +
    // 每次调用的 call-scoped grant 授权。否则每个新会话都会往用户的安全设置里
    // 塞一条 UUID 路径，白名单很快就没法人工审计了。
  },

  clearWorkingDir: (conversationId) => {
    const cid = String(conversationId || '').trim();
    if (!cid) return;
    set((state) => {
      const next = { ...state.sessionDirByConversation };
      delete next[cid];
      return { sessionDirByConversation: next };
    });
  },

  getWorkingDir: (conversationId) => {
    const cid = String(conversationId || '').trim();
    if (!cid) return undefined;
    const mounted = get().mountedDirByConversation[cid];
    if (mounted) return mounted;
    return get().sessionDirByConversation[cid];
  },

  getSessionDir: (conversationId) => {
    const cid = String(conversationId || '').trim();
    if (!cid) return undefined;
    return get().sessionDirByConversation[cid];
  },

  setMountedDir: (conversationId, absolutePath) => {
    const cid = String(conversationId || '').trim();
    const p = normalizePath(absolutePath);
    if (!cid || !p) return;
    set((state) => ({
      mountedDirByConversation: { ...state.mountedDirByConversation, [cid]: p },
    }));

    // 用户手动挂载：作为 attachment 来源写入 allowlist（更语义化，且可在设置页追溯）
    void ensureAllowlistedDirectory({
      path: p,
      source: 'attachment',
      permissions: { read: true, write: true, create: true, delete: false },
      reconnect: true,
    });
  },

  clearMountedDir: (conversationId) => {
    const cid = String(conversationId || '').trim();
    if (!cid) return;
    set((state) => {
      const next = { ...state.mountedDirByConversation };
      delete next[cid];
      return { mountedDirByConversation: next };
    });
  },

  getMountedDir: (conversationId) => {
    const cid = String(conversationId || '').trim();
    if (!cid) return undefined;
    return get().mountedDirByConversation[cid];
  },
}), {
  name: 'conversation-knowledge-mounts',
  // Knowledge mounts remain UI preferences. Document attachments are durable
  // SQLite relationships and are deliberately excluded from localStorage.
  partialize: (state) => ({
    knowledgeBaseByConversation: state.knowledgeBaseByConversation,
  }),
}));

