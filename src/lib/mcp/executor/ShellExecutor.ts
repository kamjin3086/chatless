/**
 * Shell 执行器
 * 
 * 执行 shell 命令（通过 Tauri 后端沙箱）
 */

import { useChatStore } from '@/store/chatStore';
import { getProcessSandbox } from '@/lib/skills/sandbox';

export interface ShellExecuteParams {
  assistantMessageId: string;
  conversationId: string;
  tool: string;
  args: Record<string, unknown>;
  cardId?: string;
}

export class ShellExecutor {
  constructor(private params: ShellExecuteParams) {}

  async execute(): Promise<void> {
    const { assistantMessageId, tool, args, cardId } = this.params;
    const effectiveCardId = cardId || crypto.randomUUID();

    try {
      const command = String(args.command || '');
      if (!command.trim()) {
        throw new Error('command is required');
      }

      const sandbox = getProcessSandbox();
      const isAvailable = await sandbox.isAvailable();
      if (!isAvailable) {
        throw new Error('Shell executor is not available');
      }

      // 解析命令和参数
      const parts = command.trim().split(/\s+/);
      const cmd = parts[0];
      const cmdArgs = parts.slice(1);

      const result = await sandbox.execute({
        command: cmd,
        args: cmdArgs,
        workingDir: args.workingDir ? String(args.workingDir) : undefined,
        timeoutMs: typeof args.timeout === 'number' ? args.timeout : 30000,
      });

      // 构造结果对象
      const resultData = {
        success: result.success,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        duration: result.duration,
        error: result.error,
      };

      // 更新工具卡片
      const st = useChatStore.getState();
      st.dispatchMessageAction(assistantMessageId, {
        type: 'TOOL_RESULT',
        server: 'shell_executor',
        tool,
        ok: result.success,
        data: resultData,
        cardId: effectiveCardId,
      });

      // 继续对话
      const { continueWithToolResult } = await import('../ToolCallOrchestrator');
      await continueWithToolResult({
        assistantMessageId,
        provider: 'openai',
        model: 'gpt-4',
        conversationId: this.params.conversationId,
        historyForLlm: [],
        originalUserContent: '',
        server: 'shell_executor',
        tool,
        args,
        result: resultData,
      });
    } catch (error) {
      const st = useChatStore.getState();
      st.dispatchMessageAction(assistantMessageId, {
        type: 'TOOL_RESULT',
        server: 'shell_executor',
        tool,
        ok: false,
        errorMessage: error instanceof Error ? error.message : String(error),
        cardId: effectiveCardId,
      });
    }
  }
}
