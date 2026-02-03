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
} as const;

export default filesystemCommands;
