/**
 * @deprecated 请改用 `mcpFilesystem.ts`（概念：MCP filesystem）。
 *
 * 说明：
 * - 该文件仅做兼容 re-export，避免大范围破坏现有 import 路径。
 * - 历史注释曾推荐 `skills_fs` / `user_fs` 这两个 server 名；它们已退役（没有 adapter 认领，
 *   调用只会拿到 NO_ADAPTER）。今天的名字是 `fs` 与内置的 `skill`。
 */

export {
  MCP_FILESYSTEM_SERVER_NAME as FILESYSTEM_SERVER_NAME,
  MCP_FILESYSTEM_READ_FILE_TOOL as FILESYSTEM_READ_FILE_TOOL,
  MCP_FILESYSTEM_WRITE_FILE_TOOL as FILESYSTEM_WRITE_FILE_TOOL,
  MCP_FILESYSTEM_LIST_DIR_TOOL as FILESYSTEM_LIST_DIR_TOOL,
  MCP_FILESYSTEM_TOOLS as FILESYSTEM_TOOLS,
} from './mcpFilesystem';
