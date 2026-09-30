/**
 * Agent 会话工作目录（@WorkDir）的前端入口。
 *
 * 设计目标：用户能在自己的文件系统里找到 AI 产物，而不是在应用数据目录里翻。
 * 目录结构：`文档/Chatless/<标题>-<会话 ID 摘要>/`，也是该会话的 @WorkDir。
 *
 * 目录的创建、定位、导出与清理全部由 Rust 命令完成（`workspace_*`）：这些动作写
 * 在用户的真实文件系统上，渲染进程的 plugin-fs 作用域覆盖不到那里。会话→目录的
 * 映射由 Rust 持有，前端不再按短 ID 扫目录回找，改标题也不会移动已有目录。
 */

import {
  exportWorkspace,
  ensureWorkspace,
  revealWorkspace,
  trashAllWorkspaces,
  trashWorkspace,
} from '@/lib/tauri/workspaceCommands';

export type ConversationWorkspace = {
  /** 会话工作目录（@WorkDir）。 */
  root: string;
  manifestPath: string;
  /** 这次调用真的建了目录。 */
  created: boolean;
  /** 目录现在存在于磁盘上。false 表示这个会话还没有落地过。 */
  exists: boolean;
  adoptedLegacy: boolean;
};

export type WorkspaceTrashOutcome = {
  removed: string[];
  failed: Array<{ conversationId: string; error: string }>;
};

/**
 * 解析一个会话的工作目录。目录一旦确定，路径恒定：改标题不会移动它，
 * 目录被删会按原路径重建。
 *
 * 默认只登记位置（`materialize: false`）：纯聊天的会话不该在用户的文档目录里
 * 留下空文件夹。真正落地发生在 `ensureConversationWorkspaceMaterialized`，
 * 也就是这个会话第一次用到文件或命令的时候。
 */
export async function ensureConversationWorkspace(params: {
  conversationId: string;
  title?: string;
  /** true = 现在就在磁盘上建出目录（用户主动打开/导出，或工具即将运行）。 */
  materialize?: boolean;
}): Promise<ConversationWorkspace> {
  const conversationId = String(params.conversationId || '').trim();
  if (!conversationId) throw new Error('conversationId is required');
  const info = await ensureWorkspace(conversationId, params.title, params.materialize === true);
  return {
    root: info.root,
    manifestPath: info.manifestPath,
    created: info.created,
    exists: info.exists,
    adoptedLegacy: info.adoptedLegacy,
  };
}

/**
 * 保证会话工作目录已经存在于磁盘上，返回它的路径。
 *
 * 只在"这个会话要真的动文件了"时调用：工具执行前、用户点开目录时。已经在磁盘上的
 * 会话不会再走 IPC。
 */
export async function ensureConversationWorkspaceMaterialized(
  conversationId: string,
  title?: string,
): Promise<string | undefined> {
  const { useConversationAttachmentStore } = await import('@/store/conversationAttachmentStore');
  const cid = String(conversationId || '').trim();
  if (!cid) return undefined;
  const attachments = useConversationAttachmentStore.getState();
  if (attachments.isWorkspaceMaterialized(cid)) return attachments.getSessionDir(cid);

  const workspace = await ensureConversationWorkspace({ conversationId: cid, title, materialize: true });
  attachments.setWorkingDir(cid, workspace.root);
  attachments.markWorkspaceMaterialized(cid);
  return workspace.root;
}

/** 把一个会话自带的产物目录复制到用户选择的位置。 */
export async function exportConversationWorkspace(
  conversationId: string,
  destinationDir: string,
): Promise<{
  destination: string | null;
  files: number;
  bytes: number;
  skippedSymlinks: number;
  /** 会话还没有落地过，因此没有产物可导出。 */
  sourceMissing: boolean;
}> {
  const result = await exportWorkspace(String(conversationId || '').trim(), String(destinationDir || '').trim());
  return {
    destination: result.destination,
    files: result.files,
    bytes: result.bytes,
    skippedSymlinks: result.skippedSymlinks,
    sourceMissing: result.sourceMissing,
  };
}

/** 在文件管理器中定位会话工作目录。 */
export async function revealConversationWorkspace(conversationId: string): Promise<void> {
  await revealWorkspace(String(conversationId || '').trim());
}

/**
 * 移入系统回收站并移除记录。
 *
 * `onRemoved` 只在命令真正成功后调用：清理失败时记录必须保留，界面才能重试，
 * 而不是显示"已清理"却什么都没发生。
 */
export async function trashConversationWorkspaces(
  conversationIds: string[],
  onRemoved?: (conversationId: string) => void,
): Promise<WorkspaceTrashOutcome> {
  const removed: string[] = [];
  const failed: Array<{ conversationId: string; error: string }> = [];
  for (const raw of conversationIds) {
    const conversationId = String(raw || '').trim();
    if (!conversationId) continue;
    try {
      await trashWorkspace(conversationId);
      removed.push(conversationId);
      onRemoved?.(conversationId);
    } catch (error) {
      failed.push({
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { removed, failed };
}

export async function trashEveryConversationWorkspace(): Promise<WorkspaceTrashOutcome> {
  const result = await trashAllWorkspaces();
  return { removed: result.removed || [], failed: result.failed || [] };
}
