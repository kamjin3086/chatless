/**
 * Shell Executor 原生工具
 * 
 * 提供命令执行能力，让 LLM 能执行 shell 命令（通过 Tauri 后端沙箱）
 */

import type { McpTool } from '@/lib/mcp/McpClient';

export const SHELL_EXECUTOR_SERVER_NAME = 'shell';

export const SHELL_EXECUTE_TOOL: McpTool = {
  name: 'run',
  description: '执行命令，返回 stdout/stderr/exitCode',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '完整命令（如 "node sample.js"、"python script.py"、"npm install"）',
        },
        shell: {
          type: 'string',
          enum: ['auto', 'cmd', 'powershell', 'bash'],
          description:
            'Shell 执行器（可选，默认 auto）。auto=自动选择（Win→cmd, Mac/Linux→bash）。这是指定用什么 shell 来运行命令，不是要运行的程序名。',
        },
        workingDir: {
          type: 'string',
          description: '工作目录（可选，默认 @WorkDir）',
        },
        timeout: {
          type: 'number',
          description: '超时毫秒（默认 30000）',
        },
      },
      required: ['command'],
    },
  },
};

export const SHELL_START_TOOL: McpTool = {
  name: 'start',
  description:
    '启动长时运行的后台进程（dev server、watch、长构建），立即返回句柄；'
    + '之后用 shell__logs 读输出、shell__stop 停止。不要用它跑需要等待结束的普通命令。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '完整命令（如 "pnpm dev"、"npm run watch"）' },
        shell: {
          type: 'string',
          enum: ['auto', 'cmd', 'powershell', 'bash'],
          description: 'Shell 执行器（可选，默认 auto）。',
        },
        workingDir: { type: 'string', description: '工作目录（可选，默认 @WorkDir）' },
        name: { type: 'string', description: '便于识别的名字（可选，例如 "dev-server"）' },
      },
      required: ['command'],
    },
  },
};

export const SHELL_LOGS_TOOL: McpTool = {
  name: 'logs',
  description: '读取后台进程的最新输出与运行状态（返回尾部，不是全量日志）',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        executionId: { type: 'string', description: 'shell__start 返回的句柄 id' },
        limit: { type: 'number', description: '每个流返回的最大字节数（可选，默认 8192，上限 16384）' },
      },
      required: ['executionId'],
    },
  },
};

export const SHELL_STOP_TOOL: McpTool = {
  name: 'stop',
  description: '停止由 shell__start 启动的后台进程（连同其子进程）',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        executionId: { type: 'string', description: 'shell__start 返回的句柄 id' },
      },
      required: ['executionId'],
    },
  },
};

export const SHELL_LIST_TOOL: McpTool = {
  name: 'list',
  description: '列出当前应用内启动的后台进程及其状态',
  input_schema: {
    schema: { type: 'object', properties: {}, required: [] },
  },
};

export const SHELL_EXECUTOR_TOOLS: McpTool[] = [
  SHELL_EXECUTE_TOOL,
  SHELL_START_TOOL,
  SHELL_LOGS_TOOL,
  SHELL_STOP_TOOL,
  SHELL_LIST_TOOL,
];
