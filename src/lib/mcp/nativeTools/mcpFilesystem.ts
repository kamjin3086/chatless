/**
 * MCP Filesystem 工具（概念层）
 *
 * 说明：
 * - 该“filesystem”是 MCP 层的文件系统能力（可能来自本地/远程 MCP server）
 * - 不用于 skills 资源操作（改用 skills_fs）
 * - 不用于用户授权目录操作（改用 user_fs）
 *
 * 兼容性：
 * - 目前 server 名称仍为 "filesystem"（避免破坏现有 MCP 配置/连接）
 */

import type { McpTool } from '@/lib/mcp/McpClient';

export const MCP_FILESYSTEM_SERVER_NAME = 'filesystem';

export const MCP_FILESYSTEM_READ_FILE_TOOL: McpTool = {
  name: 'read_file',
  description: '（MCP）读取文件内容。用于 MCP server 提供的文件系统能力。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        maxLines: { type: 'number', description: '最多读取行数（可选）' },
      },
      required: ['path'],
    },
  },
};

export const MCP_FILESYSTEM_WRITE_FILE_TOOL: McpTool = {
  name: 'write_file',
  description: '（MCP）写入文件内容（覆盖）。用于 MCP server 提供的文件系统能力。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        content: { type: 'string', description: '要写入的内容' },
      },
      required: ['path', 'content'],
    },
  },
};

export const MCP_FILESYSTEM_LIST_DIR_TOOL: McpTool = {
  name: 'list_directory',
  description: '（MCP）列出目录内容（文件和子目录）。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径' },
      },
      required: ['path'],
    },
  },
};

export const MCP_FILESYSTEM_TOOLS: McpTool[] = [
  MCP_FILESYSTEM_READ_FILE_TOOL,
  MCP_FILESYSTEM_WRITE_FILE_TOOL,
  MCP_FILESYSTEM_LIST_DIR_TOOL,
];

