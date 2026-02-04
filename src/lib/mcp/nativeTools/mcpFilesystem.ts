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
  description: '读取文件',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径。支持：@WorkDir/相对路径（推荐）、@别名/路径、绝对路径' },
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
  description: '写入文件（覆盖）。用于保存用户文件、任务输出、文档等。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径。支持：@WorkDir/相对路径（推荐）、@别名/路径、绝对路径。示例：@WorkDir/output/result.docx' },
        content: { type: 'string', description: '要写入的内容' },
      },
      required: ['path', 'content'],
    },
  },
};

export const MCP_FILESYSTEM_LIST_DIR_TOOL: McpTool = {
  name: 'ls',
  description: '列出目录内容',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径。支持：@WorkDir（推荐）、@别名/路径、绝对路径' },
        limit: { type: 'number', description: '最多返回条目数（可选，默认 200，上限 2000）' },
        pattern: { type: 'string', description: '名称通配符（可选，支持 * 和 ?；仅匹配当前目录这一层的 name）' },
        kind: { type: 'string', description: '筛选类型（可选）：any | file | dir（默认 any）' },
      },
      required: ['path'],
    },
  },
};

export const MCP_FILESYSTEM_CREATE_DIR_TOOL: McpTool = {
  name: 'mkdir',
  description: '创建目录',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径。支持：@WorkDir/子目录（推荐）、@别名/路径、绝对路径' },
        recursive: { type: 'boolean', description: '是否递归创建（可选，默认 true）' },
      },
      required: ['path'],
    },
  },
};

export const MCP_FILESYSTEM_DELETE_FILE_TOOL: McpTool = {
  name: 'rm',
  description: '删除文件/目录',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件/目录路径（单个）。支持 @WorkDir、@别名、绝对路径' },
        paths: { type: 'array', description: '批量删除路径列表（可选）。支持 @WorkDir、@别名、绝对路径', items: { type: 'string' } },
        dir: { type: 'string', description: '目录路径（可选；与 pattern 一起使用）。支持 @WorkDir、@别名、绝对路径' },
        pattern: { type: 'string', description: '名称通配符（可选；与 dir 一起使用，支持 * 和 ?；默认不递归）' },
        limit: { type: 'number', description: 'dir+pattern 模式最多删除/匹配条目数（可选，默认 200，上限 2000）' },
        kind: { type: 'string', description: 'dir+pattern 筛选类型（可选）：any | file | dir（默认 any）' },
        dryRun: { type: 'boolean', description: 'dir+pattern 预演（只列出 matches 不删除）（可选，默认 false）' },
      },
      required: [],
    },
  },
};

export const MCP_FILESYSTEM_RENAME_FILE_TOOL: McpTool = {
  name: 'mv',
  description: '移动/重命名',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        oldPath: { type: 'string', description: '旧路径。支持 @WorkDir、@别名、绝对路径' },
        newPath: { type: 'string', description: '新路径。支持 @WorkDir、@别名、绝对路径' },
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

