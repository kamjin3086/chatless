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

export const useConversationAttachmentStore = create<ConversationAttachmentState>((set, get) => ({
  workingDirByConversation: {},
  mountedDirByConversation: {},

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
}));

