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

export const MCP_FILESYSTEM_SERVER_NAME = 'fs';

export const MCP_FILESYSTEM_READ_FILE_TOOL: McpTool = {
  name: 'read',
  description: '读取文件内容',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        // 兼容：旧参数
        maxLines: { type: 'number', description: '最多读取行数（可选，旧参数；等价于从第 1 行开始读取 maxLines 行）' },
        // 新增：按行范围读取（1-based）
        startLine: { type: 'number', description: '起始行号（1-based，可选）' },
        endLine: { type: 'number', description: '结束行号（1-based，可选，>= startLine）' },
      },
      required: ['path'],
    },
  },
};

export const MCP_FILESYSTEM_WRITE_FILE_TOOL: McpTool = {
  name: 'write',
  description: '写入文件内容（覆盖）',
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
  name: 'ls',
  description: '列出目录内容（文件和子目录）',
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

export const MCP_FILESYSTEM_CREATE_DIR_TOOL: McpTool = {
  name: 'mkdir',
  description: '创建目录（默认递归）',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径' },
        recursive: { type: 'boolean', description: '是否递归创建（可选，默认 true）' },
      },
      required: ['path'],
    },
  },
};

export const MCP_FILESYSTEM_DELETE_FILE_TOOL: McpTool = {
  name: 'rm',
  description: '删除文件',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
      },
      required: ['path'],
    },
  },
};

export const MCP_FILESYSTEM_RENAME_FILE_TOOL: McpTool = {
  name: 'mv',
  description: '重命名/移动文件',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        oldPath: { type: 'string', description: '旧路径' },
        newPath: { type: 'string', description: '新路径' },
      },
      required: ['oldPath', 'newPath'],
    },
  },
};

export const MCP_FILESYSTEM_TOOLS: McpTool[] = [
  MCP_FILESYSTEM_READ_FILE_TOOL,
  MCP_FILESYSTEM_WRITE_FILE_TOOL,
  MCP_FILESYSTEM_LIST_DIR_TOOL,
  MCP_FILESYSTEM_CREATE_DIR_TOOL,
  MCP_FILESYSTEM_DELETE_FILE_TOOL,
  MCP_FILESYSTEM_RENAME_FILE_TOOL,
];

