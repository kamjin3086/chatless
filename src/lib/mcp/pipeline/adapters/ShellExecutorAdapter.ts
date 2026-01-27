import { getProcessSandbox } from '@/lib/skills/sandbox';
import { SHELL_EXECUTOR_SERVER_NAME } from '@/lib/mcp/nativeTools/shellExecutor';
import { buildWindowsNodeInstallHint, getAgentExperienceConfig } from '@/lib/mcp/experience/agentExperienceConfig';
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

export class ShellExecutorAdapter implements ToolAdapter {
  readonly server = SHELL_EXECUTOR_SERVER_NAME;

  canHandle(invocation: ToolInvocation): boolean {
    return invocation.server === SHELL_EXECUTOR_SERVER_NAME;
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    const args = invocation.args || {};
    const command = typeof (args as any).command === 'string' ? String((args as any).command) : '';
    if (!command.trim()) throw new Error('command is required');

    const sandbox = getProcessSandbox();
    const isAvailable = await sandbox.isAvailable();
    if (!isAvailable) throw new Error('Shell executor is not available');

    const parts = command.trim().split(/\s+/);
    const cmd = parts[0];
    const cmdArgs = parts.slice(1);
    const workingDir = typeof (args as any).workingDir === 'string' ? String((args as any).workingDir) : undefined;
    const timeoutMs = typeof (args as any).timeout === 'number' ? (args as any).timeout : 30000;

    const base = cmd.toLowerCase();
    const needsNodeRuntime = base === 'node' || base === 'npm' || base === 'pnpm' || base === 'npx' || base === 'yarn';
    if (needsNodeRuntime) {
      const env = await sandbox.checkEnvironment('node');
      if (!env.available) {
        const cfg = await getAgentExperienceConfig();
        const hint = [env.error, env.installHint, env.downloadUrl].filter(Boolean).join('\n');
        const plan = buildWindowsNodeInstallHint(cfg.windowsRuntimeInstallStrategy);
        throw new Error(
          [`Node.js 运行时不可用，无法执行：${cmd}`, hint || '', plan].filter(Boolean).join('\n').trim()
        );
      }
    }

    const tryExecute = async (c: string) =>
      sandbox.execute({
        command: c,
        args: cmdArgs,
        workingDir,
        timeoutMs,
      }, {
        executionId: `shell:${invocation.assistantMessageId}:${invocation.ensureCardId()}`,
        startTime: Date.now(),
        conversationId: invocation.conversationId,
      });

    let result = await tryExecute(cmd);

    // Windows: 一些命令（npm/pnpm/npx/yarn）通常是 *.cmd shim；后端不一定能用裸名解析到
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
    const isWindows = ua.includes('win');
    const programNotFound = String((result as any).error || '').toLowerCase().includes('program not found');
    if (isWindows && programNotFound && !cmd.includes('.') && (base === 'npm' || base === 'pnpm' || base === 'npx' || base === 'yarn')) {
      result = await tryExecute(`${cmd}.cmd`);
    }

    let note: string | undefined;
    if (!workingDir && (base === 'npm' || base === 'pnpm' || base === 'yarn' || base === 'npx')) {
      note =
        '提示：未提供 workingDir。若命令依赖项目目录（如安装依赖/运行脚本），建议显式传入工作目录以避免在默认 appData 目录执行。';
    }

    return {
      success: result.success,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      duration: result.duration,
      error: result.error,
      note,
    };
  }
}

