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

export interface SessionDocument {
  id: string;
  name: string;
  fileType: string;
  fileSize: number;
  content: string;
  documentHash?: string;
  addedAt: number;
}

interface ConversationAttachmentState {
  /**
   * 会话级默认工作区（系统自动创建并注入为 @WorkDir）
   * - 用于脚本/中间文件/产物的默认落点
   * - 不一定需要在输入框下方展示（避免噪音）
   */
  workingDirByConversation: Record<ConversationId, string | undefined>;

  /**
   * 用户手动挂载目录（通过 + 号选择）
   * - 仅用于授权/便捷访问/展示
   * - 输入框下方彩色标签条只展示这类“用户主动挂载”
   */
  mountedDirByConversation: Record<ConversationId, string | undefined>;

  /** 会话挂载的知识库（Agent knowledge_* 工具注入条件） */
  knowledgeBaseByConversation: Record<ConversationId, { id: string; name: string } | undefined>;
  sessionDocumentsByConversation: Record<ConversationId, SessionDocument[]>;

  setKnowledgeBase: (conversationId: string, kb: { id: string; name: string }) => void;
  clearKnowledgeBase: (conversationId: string) => void;
  getKnowledgeBase: (conversationId: string) => { id: string; name: string } | undefined;
  setSessionDocument: (conversationId: string, document: Omit<SessionDocument, 'addedAt'>) => void;
  clearSessionDocuments: (conversationId: string) => void;
  getSessionDocuments: (conversationId: string) => SessionDocument[];

  /** 设置系统默认 @WorkDir（自动） */
  setWorkingDir: (conversationId: string, absolutePath: string) => void;
  clearWorkingDir: (conversationId: string) => void;
  getWorkingDir: (conversationId: string) => string | undefined;

  /** 设置用户手动挂载目录（显示在输入框下方） */
  setMountedDir: (conversationId: string, absolutePath: string) => void;
  clearMountedDir: (conversationId: string) => void;
  getMountedDir: (conversationId: string) => string | undefined;
}

function normalizePath(p: string): string {
  return String(p || '').trim().replace(/\\/g, '/');
}

export const useConversationAttachmentStore = create<ConversationAttachmentState>()(persist((set, get) => ({
  workingDirByConversation: {},
  mountedDirByConversation: {},
  knowledgeBaseByConversation: {},
  sessionDocumentsByConversation: {},

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

  setSessionDocument: (conversationId, document) => {
    const cid = String(conversationId || '').trim();
    if (!cid || !document?.id || !document.content?.trim()) return;
    set((state) => {
      const existing = state.sessionDocumentsByConversation[cid] || [];
      const next = existing.filter((item) => item.id !== document.id);
      next.push({ ...document, addedAt: Date.now() });
      // Attachments are user-provided conversation records. Do not silently
      // discard older files merely because a numeric in-memory cap was hit.
      return { sessionDocumentsByConversation: { ...state.sessionDocumentsByConversation, [cid]: next } };
    });
  },

  clearSessionDocuments: (conversationId) => {
    const cid = String(conversationId || '').trim();
    if (!cid) return;
    set((state) => {
      const next = { ...state.sessionDocumentsByConversation };
      delete next[cid];
      return { sessionDocumentsByConversation: next };
    });
  },

  getSessionDocuments: (conversationId) => {
    const cid = String(conversationId || '').trim();
    return cid ? get().sessionDocumentsByConversation[cid] || [] : [];
  },

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
  // Mounts and explicitly attached source text are both user-controlled
  // conversation records. They survive restart; neither is reconstructed
  // from historic chat messages.
  partialize: (state) => ({
    knowledgeBaseByConversation: state.knowledgeBaseByConversation,
    sessionDocumentsByConversation: state.sessionDocumentsByConversation,
  }),
}));

