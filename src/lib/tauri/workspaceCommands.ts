/**
 * 会话工作目录命令（Rust 拥有目录身份）。
 *
 * 前端不再自己创建、枚举或删除 `Documents/Chatless`：那些操作需要超出渲染进程
 * 文件作用域的权限，而且前后端各存一份目录映射会漂移。这里只做类型化封装。
 */

import { invokeBackend } from './backendCommand';

export interface WorkspaceInfo {
  ok: boolean;
  conversationId: string;
  root: string;
  manifestPath: string;
  /** 这次调用真的建了目录。 */
  created: boolean;
  /** 目录现在存在于磁盘上。false 表示这个会话还没有落地过。 */
  exists: boolean;
  /** 沿用了升级前的应用数据目录。 */
  adoptedLegacy: boolean;
}

export interface WorkspaceExportResult {
  ok: boolean;
  source: string;
  /** 目录还没落地时为空。 */
  destination: string | null;
  files: number;
  bytes: number;
  skippedSymlinks: number;
  /** 会话文件夹还不存在（这个会话从未真正用过文件）。 */
  sourceMissing: boolean;
}

export interface WorkspaceTrashResult {
  ok: boolean;
  conversationId: string;
  path: string;
  /** 目录本来就不存在时为 false；记录仍然被移除。 */
  movedToTrash: boolean;
}

export interface WorkspaceTrashFailure {
  conversationId: string;
  error: string;
}

export interface WorkspaceTrashAllResult {
  ok: boolean;
  removed: string[];
  failed: WorkspaceTrashFailure[];
}

export async function ensureWorkspace(
  conversationId: string,
  title?: string,
  materialize = false,
): Promise<WorkspaceInfo> {
  return invokeBackend<WorkspaceInfo>('workspace_ensure', { conversationId, title, materialize });
}

export async function exportWorkspace(
  conversationId: string,
  destinationDir: string,
): Promise<WorkspaceExportResult> {
  return invokeBackend<WorkspaceExportResult>('workspace_export', { conversationId, destinationDir });
}

export async function trashWorkspace(conversationId: string): Promise<WorkspaceTrashResult> {
  return invokeBackend<WorkspaceTrashResult>('workspace_trash', { conversationId });
}

export async function trashAllWorkspaces(): Promise<WorkspaceTrashAllResult> {
  return invokeBackend<WorkspaceTrashAllResult>('workspace_trash_all');
}

export async function revealWorkspace(conversationId: string): Promise<{ ok: boolean; path: string }> {
  return invokeBackend<{ ok: boolean; path: string }>('workspace_reveal', { conversationId });
}

/** 会话清单文本；没有清单时返回 null。 */
export async function readWorkspaceManifest(conversationId: string): Promise<string | null> {
  return invokeBackend<string | null>('workspace_read_manifest', { conversationId });
}

/** 覆盖会话清单。清单只写会话自己的产物目录，不写用户附加的项目目录。 */
export async function writeWorkspaceManifest(
  conversationId: string,
  content: string,
): Promise<{ ok: boolean; path: string }> {
  return invokeBackend<{ ok: boolean; path: string }>('workspace_write_manifest', { conversationId, content });
}
