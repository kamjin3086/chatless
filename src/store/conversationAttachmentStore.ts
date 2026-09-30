/**
 * 会话级“附加内容”状态。
 *
 * 用于提升 Agent 体验：例如“附加工作目录”，让当前会话的 Agent 可以在该目录及子目录工作。
 *
 * 挂载目录的作用域是**这个会话**：勾选后重启仍然有效，卸载即撤销。它不会被写进
 * 全局文件白名单——那会让"选一个工作目录"变成一条永久授权，安全设置里很快就会
 * 堆满无法人工审计的条目。真正的访问校验仍在执行时按调用授予。
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ConversationId = string;

interface ConversationAttachmentState {
  /**
   * 会话自带的产物目录（文档/Chatless/<标题>-<会话 ID 摘要>；旧会话沿用原应用数据目录）。
   * 没有挂载目录时它就是 @WorkDir。
   */
  sessionDirByConversation: Record<ConversationId, string | undefined>;

  /**
   * 该会话的工作目录是否已经在磁盘上落地。
   *
   * 目录采用"用到才建"策略：只有工具真的要动文件、或用户主动打开/导出时才创建，
   * 纯聊天的会话不在用户的文档目录里留空文件夹。这个标记只是内存缓存，
   * 重启后第一次使用会重新确认一次。
   */
  workspaceExistsByConversation: Record<ConversationId, boolean | undefined>;

  /**
   * 用户手动挂载目录（通过 + 号选择）。
   * 一旦挂载，它就是该会话的 @WorkDir：相对路径与默认落点都指向这里。
   */
  mountedDirByConversation: Record<ConversationId, string | undefined>;

  /** 会话工作目录解析失败的原因（不持久化；用于界面提示与重试）。 */
  workspaceErrorByConversation: Record<ConversationId, string | undefined>;

  /** 会话挂载的知识库（Agent knowledge_* 工具注入条件） */
  knowledgeBaseByConversation: Record<ConversationId, { id: string; name: string } | undefined>;

  setKnowledgeBase: (conversationId: string, kb: { id: string; name: string }) => void;
  clearKnowledgeBase: (conversationId: string) => void;
  getKnowledgeBase: (conversationId: string) => { id: string; name: string } | undefined;

  /** 记录会话自带的产物目录（系统自动解析，不作为用户授权） */
  setWorkingDir: (conversationId: string, absolutePath: string, exists?: boolean) => void;
  clearWorkingDir: (conversationId: string) => void;
  /** 实际生效的 @WorkDir：挂载目录优先，否则会话产物目录 */
  getWorkingDir: (conversationId: string) => string | undefined;
  /** 仅会话自带产物目录（不返回挂载目录）——应用元数据只写这里 */
  getSessionDir: (conversationId: string) => string | undefined;
  /** 会话目录是否已经存在于磁盘上。 */
  isWorkspaceMaterialized: (conversationId: string) => boolean;
  markWorkspaceMaterialized: (conversationId: string) => void;
  /**
   * 会话自带的产物目录是否正在被这个会话当作 @WorkDir 使用。
   * 用户挂载了自己的目录之后就是 false：应用不该在用户的项目旁边再建一个文件夹。
   */
  isSessionDirInUse: (conversationId: string) => boolean;

  setWorkspaceError: (conversationId: string, message: string) => void;
  clearWorkspaceError: (conversationId: string) => void;
  getWorkspaceError: (conversationId: string) => string | undefined;

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
  workspaceExistsByConversation: {},
  mountedDirByConversation: {},
  workspaceErrorByConversation: {},
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


  setWorkingDir: (conversationId, absolutePath, exists = true) => {
    const cid = String(conversationId || '').trim();
    const p = normalizePath(absolutePath);
    if (!cid || !p) return;
    set((state) => ({
      sessionDirByConversation: { ...state.sessionDirByConversation, [cid]: p },
      workspaceExistsByConversation: { ...state.workspaceExistsByConversation, [cid]: exists },
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
      const exists = { ...state.workspaceExistsByConversation };
      delete exists[cid];
      return { sessionDirByConversation: next, workspaceExistsByConversation: exists };
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

  isWorkspaceMaterialized: (conversationId) => {
    const cid = String(conversationId || '').trim();
    if (!cid) return false;
    return get().workspaceExistsByConversation[cid] === true;
  },

  markWorkspaceMaterialized: (conversationId) => {
    const cid = String(conversationId || '').trim();
    if (!cid) return;
    set((state) => ({
      workspaceExistsByConversation: { ...state.workspaceExistsByConversation, [cid]: true },
    }));
  },

  isSessionDirInUse: (conversationId) => {
    const cid = String(conversationId || '').trim();
    if (!cid) return false;
    const state = get();
    return !!state.sessionDirByConversation[cid] && !state.mountedDirByConversation[cid];
  },

  setMountedDir: (conversationId, absolutePath) => {
    const cid = String(conversationId || '').trim();
    const p = normalizePath(absolutePath);
    if (!cid || !p) return;
    set((state) => ({
      mountedDirByConversation: { ...state.mountedDirByConversation, [cid]: p },
    }));
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

  setWorkspaceError: (conversationId, message) => {
    const cid = String(conversationId || '').trim();
    if (!cid) return;
    set((state) => ({
      workspaceErrorByConversation: { ...state.workspaceErrorByConversation, [cid]: message },
    }));
  },

  clearWorkspaceError: (conversationId) => {
    const cid = String(conversationId || '').trim();
    if (!cid) return;
    set((state) => {
      const next = { ...state.workspaceErrorByConversation };
      delete next[cid];
      return { workspaceErrorByConversation: next };
    });
  },

  getWorkspaceError: (conversationId) => {
    const cid = String(conversationId || '').trim();
    if (!cid) return undefined;
    return get().workspaceErrorByConversation[cid];
  },
}), {
  name: 'conversation-knowledge-mounts',
  // 知识库挂载与附加目录是会话级偏好；文档附件是 SQLite 关系，不进 localStorage。
  // 会话自带产物目录由 Rust 持有映射，也不在这里持久化。
  partialize: (state) => ({
    knowledgeBaseByConversation: state.knowledgeBaseByConversation,
    mountedDirByConversation: state.mountedDirByConversation,
  }),
}));

