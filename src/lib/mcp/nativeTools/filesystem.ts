/**
 * @deprecated 请改用 `mcpFilesystem.ts`（概念：MCP filesystem）。
 *
 * 说明：
 * - 该文件仅做兼容 re-export，避免大范围破坏现有 import 路径。
 * - skills 资源读写请使用 `skills_fs`；用户目录读写请使用 `user_fs`。
 */

export {
  MCP_FILESYSTEM_SERVER_NAME as FILESYSTEM_SERVER_NAME,
  MCP_FILESYSTEM_READ_FILE_TOOL as FILESYSTEM_READ_FILE_TOOL,
  MCP_FILESYSTEM_WRITE_FILE_TOOL as FILESYSTEM_WRITE_FILE_TOOL,
  MCP_FILESYSTEM_LIST_DIR_TOOL as FILESYSTEM_LIST_DIR_TOOL,
  MCP_FILESYSTEM_TOOLS as FILESYSTEM_TOOLS,
} from './mcpFilesystem';
