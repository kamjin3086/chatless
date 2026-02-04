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

export const SHELL_EXECUTOR_TOOLS: McpTool[] = [SHELL_EXECUTE_TOOL];
