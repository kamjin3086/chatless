/**
 * Shell Executor 原生工具
 * 
 * 提供命令执行能力，让 LLM 能执行 shell 命令（通过 Tauri 后端沙箱）
 */

import type { McpTool } from '@/lib/mcp/McpClient';

export const SHELL_EXECUTOR_SERVER_NAME = 'shell';

export const SHELL_EXECUTE_TOOL: McpTool = {
  name: 'run',
  description: 'Run a command and return stdout/stderr/exitCode',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The full command (for example "node sample.js", "python script.py", "npm install")',
        },
        shell: {
          type: 'string',
          enum: ['auto', 'cmd', 'powershell', 'bash'],
          description:
            'Command interpreter (optional, default auto). auto picks cmd on Windows and bash on macOS/Linux. This selects the shell that runs the command; it is not the name of the program.',
        },
        workingDir: {
          type: 'string',
          description: 'Working directory (optional, default @WorkDir)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default 30000)',
        },
      },
      required: ['command'],
    },
  },
};

export const SHELL_START_TOOL: McpTool = {
  name: 'start',
  description:
    'Start a long-running background process (dev server, watcher, long build) and return a handle immediately. '
    + 'Read its output with shell__logs and stop it with shell__stop. Do not use it for ordinary commands you wait for.',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The full command (for example "pnpm dev", "npm run watch")' },
        shell: {
          type: 'string',
          enum: ['auto', 'cmd', 'powershell', 'bash'],
          description: 'Command interpreter (optional, default auto).',
        },
        workingDir: { type: 'string', description: 'Working directory (optional, default @WorkDir)' },
        name: { type: 'string', description: 'A readable name (optional, for example "dev-server")' },
      },
      required: ['command'],
    },
  },
};

export const SHELL_LOGS_TOOL: McpTool = {
  name: 'logs',
  description: 'Read the latest output and status of a background process (the tail, not the whole log)',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        executionId: { type: 'string', description: 'The handle id returned by shell__start' },
        limit: { type: 'number', description: 'Maximum bytes per stream (optional, default 8192, max 16384)' },
      },
      required: ['executionId'],
    },
  },
};

export const SHELL_STOP_TOOL: McpTool = {
  name: 'stop',
  description: 'Stop a background process started by shell__start (together with its children)',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        executionId: { type: 'string', description: 'The handle id returned by shell__start' },
      },
      required: ['executionId'],
    },
  },
};

export const SHELL_LIST_TOOL: McpTool = {
  name: 'list',
  description: 'List the background processes this app started and their status',
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
