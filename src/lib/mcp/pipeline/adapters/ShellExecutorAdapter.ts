import { getProcessSandbox, type ProcessSandbox } from '@/lib/skills/sandbox';
import { SHELL_EXECUTOR_SERVER_NAME } from '@/lib/mcp/nativeTools/shellExecutor';
import { buildWindowsNodeInstallHint, getAgentExperienceConfig } from '@/lib/mcp/experience/agentExperienceConfig';
import { useFilesystemAllowlistStore } from '@/store/filesystemAllowlistStore';
import { planCommand } from '@/lib/shell/commandPlan';
import { buildFatalErrorHints } from '@/lib/mcp/pipeline/toolResultDiagnostics';
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

type ShellFailure = { ok: false; error: { code: string; message: string; hints: string[] } };

function failure(code: string, message: string, hints: string[] = []): ShellFailure {
  return { ok: false, error: { code, message, hints } };
}

/**
 * The `shell` tool surface: one blocking entry (`run`), one managed-process
 * lifecycle (`start`/`logs`/`stop`/`list`). Both command paths share
 * `planCommand`, so the interpreter and the working directory a call was
 * approved with are the ones that actually run.
 */
export class ShellExecutorAdapter implements ToolAdapter {
  readonly server = SHELL_EXECUTOR_SERVER_NAME;

  canHandle(invocation: ToolInvocation): boolean {
    return invocation.server === SHELL_EXECUTOR_SERVER_NAME;
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    const args = (invocation.args || {}) as Record<string, unknown>;
    const toolName = String(invocation.tool || '').toLowerCase();
    const sandbox = getProcessSandbox();
    const executionId = `shell:${invocation.assistantMessageId}:${invocation.ensureCardId()}`;
    const workingDir = typeof args.workingDir === 'string' ? String(args.workingDir) : undefined;

    if (toolName === 'start') return this.start(invocation, args, executionId);
    if (toolName === 'logs') return this.logs(invocation, args);
    if (toolName === 'stop') return this.stop(invocation, args);
    if (toolName === 'list') return this.list(invocation);

    // Blocking execution.
    const command = typeof args.command === 'string' ? String(args.command) : '';
    if (!command.trim()) return failure('INVALID_ARGUMENTS', 'command is required');
    const timeoutMs = typeof args.timeout === 'number' ? Number(args.timeout) : 30000;

    const planResult = planCommand({ command, shell: args.shell ?? args.shellType ?? args.shell_type });
    if (!planResult.ok) return failure(planResult.code, planResult.message, planResult.hints);
    const { plan } = planResult;

    if (!(await sandbox.isAvailable())) {
      return failure('SHELL_UNAVAILABLE', 'Shell executor is not available');
    }

    const missingRuntime = await this.missingNodeRuntime(command);
    if (missingRuntime) return missingRuntime;

    await this.syncAllowedWorkingDirs(invocation, sandbox);

    const result = await sandbox.execute(
      { command: plan.file, args: plan.args, workingDir, timeoutMs, verbatimLastArg: plan.verbatimLastArg },
      { executionId, startTime: Date.now(), conversationId: invocation.conversationId },
    );

    const note = [
      plan.autoSelected ? `No shell was given, so the platform default ${plan.shell} was used.` : undefined,
      !workingDir && /\b(npm|pnpm|yarn|npx)\b/i.test(command)
        ? 'Note: no workingDir was provided, so the command runs in the app default directory. Commands that need the project directory must pass workingDir explicitly.'
        : undefined,
    ]
      .filter(Boolean)
      .join('\n');

    const out: Record<string, unknown> = {
      success: result.success,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      duration: result.duration,
      error: result.error,
      timedOut: result.status === 'timeout',
      shell: plan.shell,
    };
    if (note) out.note = note;

    if (result.success) return out;

    // A non-zero exit or a killed timeout is a known outcome. Keep stdout and
    // stderr in the result: the tail is usually the only place the cause is
    // visible, and the caller must not treat it as an unknown side effect.
    const message = String(result.error || result.stderr || 'command failed').trim().slice(0, 400);
    out.errorDetails = {
      code: result.status === 'timeout' ? 'SHELL_TIMEOUT' : 'SHELL_COMMAND_FAILED',
      message,
      hints: buildFatalErrorHints({ server: 'shell', tool: 'run' }, message),
      timedOut: result.status === 'timeout',
    };
    return out;
  }

  private async start(
    invocation: ToolInvocation,
    args: Record<string, unknown>,
    executionId: string,
  ): Promise<unknown> {
    const command = typeof args.command === 'string' ? String(args.command).trim() : '';
    if (!command) return failure('INVALID_ARGUMENTS', 'command is required');

    const planResult = planCommand({ command, shell: args.shell ?? args.shellType ?? args.shell_type });
    if (!planResult.ok) return failure(planResult.code, planResult.message, planResult.hints);
    const { plan } = planResult;

    const sandbox = getProcessSandbox();
    if (!(await sandbox.isAvailable())) {
      return failure('SHELL_UNAVAILABLE', 'Shell executor is not available');
    }
    const missingRuntime = await this.missingNodeRuntime(command);
    if (missingRuntime) return missingRuntime;
    await this.syncAllowedWorkingDirs(invocation, sandbox);

    try {
      const started = await sandbox.startManagedProcess({
        executionId,
        conversationId: invocation.conversationId,
        runId: invocation.assistantMessageId,
        name: typeof args.name === 'string' ? String(args.name) : undefined,
        command: plan.file,
        args: plan.args,
        verbatimLastArg: plan.verbatimLastArg,
        workingDir: typeof args.workingDir === 'string' ? String(args.workingDir) : undefined,
      });
      return {
        ok: true,
        executionId: started.executionId,
        pid: started.pid,
        command,
        shell: plan.shell,
        name: typeof args.name === 'string' ? String(args.name) : undefined,
        message: 'The process is running in the background. Read its output with shell__logs and stop it with shell__stop.',
      };
    } catch (error) {
      return failure('START_FAILED', error instanceof Error ? error.message : String(error));
    }
  }

  private async logs(invocation: ToolInvocation, args: Record<string, unknown>) {
    const executionId = String(args.executionId || '').trim();
    if (!executionId) return failure('INVALID_ARGUMENTS', 'executionId is required');
    const limit = typeof args.limit === 'number' ? Number(args.limit) : undefined;
    try {
      const output = await getProcessSandbox().readManagedProcess(executionId, limit, invocation.conversationId);
      return { ok: true, ...output };
    } catch (error) {
      return failure('LOGS_FAILED', error instanceof Error ? error.message : String(error));
    }
  }

  private async stop(invocation: ToolInvocation, args: Record<string, unknown>) {
    const executionId = String(args.executionId || '').trim();
    if (!executionId) return failure('INVALID_ARGUMENTS', 'executionId is required');
    try {
      const stopped = await getProcessSandbox().stopManagedProcess(executionId, invocation.conversationId);
      return { ok: true, ...stopped };
    } catch (error) {
      return failure('STOP_FAILED', error instanceof Error ? error.message : String(error));
    }
  }

  private async list(invocation: ToolInvocation) {
    try {
      return { ok: true, processes: await getProcessSandbox().listManagedProcesses(invocation.conversationId) };
    } catch (error) {
      return failure('LIST_FAILED', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * A missing Node runtime produces a "not recognized" error that reads like a
   * broken command, so it is checked up front and reported as an install hint.
   */
  private async missingNodeRuntime(command: string): Promise<ShellFailure | undefined> {
    if (!/\b(node|npm|pnpm|npx|yarn)\b/i.test(command)) return undefined;
    const env = await getProcessSandbox().checkEnvironment('node');
    if (env.available) return undefined;
    const cfg = await getAgentExperienceConfig();
    const hint = [env.error, env.installHint, env.downloadUrl].filter(Boolean).join('\n');
    const plan = buildWindowsNodeInstallHint(cfg.windowsRuntimeInstallStrategy);
    return failure(
      'NODE_RUNTIME_NOT_AVAILABLE',
      ['The command uses node/npm/pnpm/npx/yarn, but no Node.js runtime was found.', hint, plan].filter(Boolean).join('\n').trim(),
    );
  }

  /** Keeps the frontend pre-check in step with the user's persistent allowlist. */
  private async syncAllowedWorkingDirs(invocation: ToolInvocation, sandbox: ProcessSandbox) {
    try {
      const store = useFilesystemAllowlistStore.getState();
      await store.load();
      const dirs = (store.directories || []).map((dir) => String(dir.path || '').replace(/\\/g, '/'));
      try {
        const { useConversationAttachmentStore } = await import('@/store/conversationAttachmentStore');
        const workDir = useConversationAttachmentStore.getState().getWorkingDir(invocation.conversationId);
        if (workDir) dirs.unshift(String(workDir).replace(/\\/g, '/'));
      } catch {
        // A missing session working directory is not an error.
      }
      sandbox.setAllowedWorkingDirs(dirs);
    } catch {
      // best-effort: the backend re-checks every path it is given
    }
  }
}
