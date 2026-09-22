/**
 * Tauri filesystem 命令封装层
 *
 * 提供类型安全的 API，自动处理：
 * 1. payload 包裹
 * 2. camelCase → snake_case 参数转换
 * 3. snake_case → camelCase 返回值转换
 */

import { keysToSnakeCase, keysToCamelCase } from './caseTransform';

// ============================================
// 类型定义（前端使用 camelCase）
// ============================================

/** 文件/目录条目 */
export interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
}

/** 列出目录结果 */
export interface ListDirectoryResult {
  ok: boolean;
  path: string;
  entries: FsEntry[];
  truncated: boolean;
  returnedCount: number;
  limit: number;
}

/** 通用操作结果 */
export interface OkResult {
  ok: boolean;
  message: string;
  path: string;
  /** 本次覆盖前保存的版本 ID（有历史时才返回）。 */
  historyId?: string;
  /** 该文件当前保留的历史版本数。 */
  historyCount?: number;
}

/** 读取文件结果 */
export interface ReadFileResult {
  ok: boolean;
  path: string;
  totalLines: number;
  startLine: number;
  endLine: number;
  content: string;
  truncated: boolean;
  /** sha256 of the whole file; an edit can pass it back to detect staleness. */
  hash: string;
}

// ============================================
// 参数类型定义
// ============================================

export interface ReadFileParams {
  path: string;
  maxLines?: number;
  startLine?: number;
  endLine?: number;
}

export interface WriteFileParams {
  path: string;
  content: string;
}

export interface EditFileParams {
  path: string;
  find: string;
  replace: string;
  all?: boolean;
  /** sha256 returned by the last read; a stale value refuses the edit. */
  expectedHash?: string;
}

export interface EditFileResult {
  ok: boolean;
  path: string;
  replacements: number;
  line?: number | null;
  reason?: string | null;
  candidates: string[];
  historyId?: string;
  historyCount?: number;
}

export interface FileHistoryVersion {
  id: string;
  createdAt: number;
  bytes: number;
  /** 产生这次覆盖的操作：write / edit / restore */
  tool: string;
  sha256: string;
}

export interface FileHistoryResult {
  ok: boolean;
  path: string;
  versions: FileHistoryVersion[];
}

export interface SearchFilesParams {
  root: string;
  query: string;
  glob?: string;
  limit?: number;
  regex?: boolean;
  /** content | filename | both (default both). */
  mode?: 'content' | 'filename' | 'both';
}

export interface SearchMatch {
  path: string;
  /** 1-based line number; absent for a filename match. */
  line?: number | null;
  text: string;
  kind: 'content' | 'filename';
}

export interface SearchSkip {
  path: string;
  reason: string;
}

export interface SearchFilesResult {
  ok: boolean;
  root: string;
  mode: 'content' | 'filename' | 'both';
  matches: SearchMatch[];
  truncated: boolean;
  /** Part of the tree could not be read, so "no matches" is not conclusive. */
  partial: boolean;
  filesScanned: number;
  skippedCount: number;
  skipped: SearchSkip[];
  limit: number;
}

export interface ListDirectoryParams {
  path: string;
  limit?: number;
  pattern?: string;
  kind?: string;
}

export interface CreateDirectoryParams {
  path: string;
  recursive?: boolean;
}

export interface DeleteFileParams {
  path: string;
}

export interface DeleteManyParams {
  paths: string[];
}

export interface DeleteByPatternParams {
  dir: string;
  pattern: string;
  limit?: number;
  kind?: string;
  dryRun?: boolean;
}

export interface RenameFileParams {
  oldPath: string;
  newPath: string;
}

export interface SetAllowlistParams {
  directories: Array<{
    path: string;
    permissions: {
      read: boolean;
      write: boolean;
      create: boolean;
      delete: boolean;
    };
  }>;
  version?: number;
}

/**
 * 一次调用授权（run/call 级）。只存在于 Rust 内存中，不写入磁盘，
 * 也不会成为其他会话或其他调用的授权。
 */
export interface GrantCallScopeParams {
  runId: string;
  callId?: string;
  path: string;
  read?: boolean;
  write?: boolean;
  create?: boolean;
  delete?: boolean;
}

export interface RevokeCallScopeParams {
  runId: string;
  callId?: string;
}

// ============================================
// 内部工具函数
// ============================================

let cachedInvoke: typeof import('@tauri-apps/api/core').invoke | null = null;

/**
 * 获取 invoke 函数（惰性加载，避免 SSR 报错）
 */
async function getInvoke(): Promise<typeof import('@tauri-apps/api/core').invoke> {
  if (!cachedInvoke) {
    const { invoke } = await import('@tauri-apps/api/core');
    cachedInvoke = invoke;
  }
  return cachedInvoke;
}

/**
 * 封装的 invoke 调用
 * - 自动将参数转换为 snake_case
 * - 自动将返回值转换为 camelCase
 * - 统一使用 payload 包裹
 */
async function invokeFs<TParams, TResult>(
  command: string,
  params: TParams
): Promise<TResult> {
  const invoke = await getInvoke();
  const snakeCasePayload = keysToSnakeCase(params);
  const result = await invoke<unknown>(command, { payload: snakeCasePayload });
  return keysToCamelCase(result) as TResult;
}

// ============================================
// 公开 API
// ============================================

/**
 * 读取文件内容
 */
export async function readFile(params: ReadFileParams): Promise<ReadFileResult> {
  return invokeFs<ReadFileParams, ReadFileResult>('filesystem_read_file', params);
}

/**
 * 写入文件内容
 */
export async function writeFile(params: WriteFileParams): Promise<OkResult> {
  return invokeFs<WriteFileParams, OkResult>('filesystem_write_file', params);
}

/**
 * 某个文件保留的历史版本（最近 20 版，最新在前）。
 * 覆盖/编辑前的内容会自动保存到应用数据目录，不污染用户目录。
 */
export async function fileHistory(path: string): Promise<FileHistoryResult> {
  return invokeFs<{ path: string }, FileHistoryResult>('filesystem_file_history', { path });
}

/**
 * 恢复到某个历史版本。恢复前会把当前内容也记入历史，所以恢复本身可以撤销。
 */
export async function restoreFileVersion(path: string, versionId: string): Promise<OkResult> {
  return invokeFs<{ path: string; versionId: string }, OkResult>('filesystem_restore_file_version', {
    path,
    versionId,
  });
}

/**
 * 精确编辑：把 find 替换为 replace（默认要求唯一匹配）
 */
export async function editFile(params: EditFileParams): Promise<EditFileResult> {
  return invokeFs<EditFileParams, EditFileResult>('filesystem_edit_file', params);
}

/**
 * 在目录中搜索内容/文件名
 */
export async function searchFiles(params: SearchFilesParams): Promise<SearchFilesResult> {
  return invokeFs<SearchFilesParams, SearchFilesResult>('filesystem_search_files', params);
}

/**
 * 列出目录内容
 */
export async function listDirectory(params: ListDirectoryParams): Promise<ListDirectoryResult> {
  return invokeFs<ListDirectoryParams, ListDirectoryResult>('filesystem_list_directory', params);
}

/**
 * 创建目录
 */
export async function createDirectory(params: CreateDirectoryParams): Promise<OkResult> {
  return invokeFs<CreateDirectoryParams, OkResult>('filesystem_create_directory', params);
}

/**
 * 删除单个文件
 */
export async function deleteFile(params: DeleteFileParams): Promise<OkResult> {
  return invokeFs<DeleteFileParams, OkResult>('filesystem_delete_file', params);
}

/**
 * 批量删除文件
 */
export async function deleteMany(params: DeleteManyParams): Promise<OkResult> {
  return invokeFs<DeleteManyParams, OkResult>('filesystem_delete_many', params);
}

/**
 * 按模式删除文件
 */
export async function deleteByPattern(params: DeleteByPatternParams): Promise<OkResult> {
  return invokeFs<DeleteByPatternParams, OkResult>('filesystem_delete_by_pattern', params);
}

/**
 * 重命名/移动文件
 */
export async function renameFile(params: RenameFileParams): Promise<OkResult> {
  return invokeFs<RenameFileParams, OkResult>('filesystem_rename_file', params);
}

/**
 * 设置文件系统白名单
 */
export async function setAllowlist(params: SetAllowlistParams): Promise<OkResult> {
  return invokeFs<SetAllowlistParams, OkResult>('filesystem_set_allowlist', params);
}

/** 登记一次调用授权（仅内存，绑定 run/call） */
export async function grantCallScope(params: GrantCallScopeParams): Promise<{ ok: boolean; path: string }> {
  return invokeFs<GrantCallScopeParams, { ok: boolean; path: string }>('filesystem_grant_call_scope', params);
}

/** 撤销某个 run/call 的一次性授权 */
export async function revokeCallScope(params: RevokeCallScopeParams): Promise<OkResult> {
  return invokeFs<RevokeCallScopeParams, OkResult>('filesystem_revoke_call_scope', params);
}

// ============================================
// 命名空间导出（方便使用）
// ============================================

export const filesystemCommands = {
  readFile,
  writeFile,
  listDirectory,
  createDirectory,
  deleteFile,
  deleteMany,
  deleteByPattern,
  renameFile,
  setAllowlist,
  grantCallScope,
  revokeCallScope,
} as const;

export default filesystemCommands;
