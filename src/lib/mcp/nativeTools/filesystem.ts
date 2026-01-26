/**
 * Filesystem 原生工具
 * 
 * 提供文件系统操作能力，让 LLM 能读写文件（基于 Tauri fs API）
 */

import type { McpTool } from '@/lib/mcp/McpClient';

export const FILESYSTEM_SERVER_NAME = 'filesystem';

export const FILESYSTEM_READ_FILE_TOOL: McpTool = {
  name: 'read_file',
  description: '读取文件内容。支持文本文件（自动 UTF-8 解码）。支持路径别名：@skill/file.md（自动解析为skill目录下的文件）。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件路径（支持 @skill/file.md 别名、相对路径或绝对路径）',
        },
        maxLines: {
          type: 'number',
          description: '最多读取的行数（可选，用于大文件）',
        },
      },
      required: ['path'],
    },
  },
};

export const FILESYSTEM_WRITE_FILE_TOOL: McpTool = {
  name: 'write_file',
  description: '写入文件内容（会覆盖已存在的文件）。支持路径别名：@skill/script.js。中高风险操作需要用户审批。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件路径（支持 @skill/script.js 别名）',
        },
        content: {
          type: 'string',
          description: '要写入的文件内容',
        },
      },
      required: ['path', 'content'],
    },
  },
};

export const FILESYSTEM_LIST_DIR_TOOL: McpTool = {
  name: 'list_directory',
  description: '列出目录内容（文件和子目录）。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '目录路径',
        },
      },
      required: ['path'],
    },
  },
};

export const FILESYSTEM_TOOLS: McpTool[] = [
  FILESYSTEM_READ_FILE_TOOL,
  FILESYSTEM_WRITE_FILE_TOOL,
  FILESYSTEM_LIST_DIR_TOOL,
];
