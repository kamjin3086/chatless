/**
 * Shell Executor 原生工具
 * 
 * 提供命令执行能力，让 LLM 能执行 shell 命令（通过 Tauri 后端沙箱）
 */

import type { McpTool } from '@/lib/mcp/McpClient';

export const SHELL_EXECUTOR_SERVER_NAME = 'shell_executor';

export const SHELL_EXECUTE_TOOL: McpTool = {
  name: 'execute_command',
  description: '在沙箱中执行 shell 命令（支持 bash/powershell/python/node 等）。中高风险命令需要用户审批。返回 stdout、stderr 和 exit code。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '要执行的命令（如 "python script.py"、"npm install"、"pandoc input.docx -o output.md"）',
        },
        workingDir: {
          type: 'string',
          description: '工作目录（可选，默认为 appData 目录）',
        },
        timeout: {
          type: 'number',
          description: '超时时间（毫秒，默认 30000）',
        },
      },
      required: ['command'],
    },
  },
};

export const SHELL_EXECUTOR_TOOLS: McpTool[] = [SHELL_EXECUTE_TOOL];
