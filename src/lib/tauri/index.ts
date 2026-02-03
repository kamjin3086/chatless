/**
 * Tauri 命令封装层入口
 *
 * 提供统一的 API 用于前端调用 Tauri 后端命令
 */

// 大小写转换工具
export { camelToSnake, snakeToCamel, keysToSnakeCase, keysToCamelCase } from './caseTransform';

// Filesystem 命令
export {
  filesystemCommands,
  readFile,
  writeFile,
  listDirectory,
  createDirectory,
  deleteFile,
  deleteMany,
  deleteByPattern,
  renameFile,
  setAllowlist,
} from './filesystemCommands';

// 类型导出
export type {
  FsEntry,
  ListDirectoryResult,
  OkResult,
  ReadFileResult,
  ReadFileParams,
  WriteFileParams,
  ListDirectoryParams,
  CreateDirectoryParams,
  DeleteFileParams,
  DeleteManyParams,
  DeleteByPatternParams,
  RenameFileParams,
  SetAllowlistParams,
} from './filesystemCommands';
