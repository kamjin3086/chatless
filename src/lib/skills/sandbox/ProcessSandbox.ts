/**
 * 进程沙箱执行器
 * 
 * 通过 Tauri 后端提供受限的命令执行能力
 */

import { 
  BaseSandboxExecutor, 
  type SandboxExecutorEvents 
} from './ISandboxExecutor';
import type {
  ExecuteOptions,
  ExecuteResult,
  ExecutionContext,
  SandboxSecurityConfig,
  EnvironmentCheckResult,
} from './types';
import { CommandValidator } from './validators';

/**
 * Tauri 后端返回的 Shell 执行结果
 */
interface TauriShellResult {
  success: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  /** 超时被终止；stdout/stderr 是终止前抓到的输出 */
  timed_out?: boolean;
  error?: string;
}

/** One of the background processes started through `shell__start`. */
export interface ManagedProcessOutput {
  executionId: string;
  running: boolean;
  exitCode?: number | null;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutDropped: number;
  stderrDropped: number;
}

export interface ManagedProcessSummary {
  executionId: string;
  pid: number;
  command: string;
  workingDir: string;
  name?: string;
  conversationId: string;
  runId?: string;
  running: boolean;
  exitCode?: number | null;
  startedAt: number;
  stdoutBytes: number;
  stderrBytes: number;
}

/**
 * Tauri 后端返回的运行时检测结果
 */
interface TauriRuntimeCheckResult {
  available: boolean;
  runtime: string;
  version?: string;
  path?: string;
  error?: string;
  install_hint?: string;
  download_url?: string;
}

/**
 * 进程沙箱执行器
 * 
 * 使用 Tauri 后端的 run_safe_shell 命令执行
 */
export class ProcessSandbox extends BaseSandboxExecutor {
  readonly type = 'process' as const;
  readonly name = 'Process Sandbox';
  
  private commandValidator: CommandValidator;
  private isInitialized = false;

  constructor(config?: SandboxSecurityConfig, events?: SandboxExecutorEvents) {
    super(config, events);
    this.commandValidator = new CommandValidator({
      strictMode: false,
      allowPipeAndRedirect: true,
    });
  }

  /**
   * 更新允许的工作目录列表（用于将 filesystem allowlist 与 shell_executor 统一）
   * - 仅影响前端预校验（CommandValidator.validatePath）
   * - 后端仍会执行自身的安全校验
   */
  setAllowedWorkingDirs(dirs: string[]): void {
    try {
      const list = Array.isArray(dirs) ? dirs : [];
      const normalized = list
        .map((p) => String(p || '').trim().replace(/\\/g, '/').replace(/\/+$/g, ''))
        .filter(Boolean);
      this.commandValidator.updateConfig({ allowedWorkingDirs: normalized });
    } catch {
      // ignore
    }
  }

  /**
   * 检查执行器是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      // 已初始化则直接返回，避免每次 tool call 都触发一次 invoke/appDataDir（会造成“首个工具卡片延迟几秒才开跑”的观感）
      if (this.isInitialized) {
        return true;
      }
      // 检查是否在 Tauri 环境中
      if (typeof window === 'undefined') {
        return false;
      }

      const { invoke } = await import('@tauri-apps/api/core');
      
      // 尝试调用校验命令确认后端可用
      await invoke('validate_command', { 
        command: 'echo test',
        workingDir: null,
      });

      // 默认工作目录白名单（生产环境）：限制在 appDataDir 之下
      // - dev/非 tauri 环境不会走到这里
      // - 具体 action 的 workingDir 仍会被 validatePath 进一步校验
      try {
        const { appDataDir } = await import('@tauri-apps/api/path');
        const appData = await appDataDir();
        // 统一分隔符，避免 Windows 下 `C:\...` 与 `C:/...` 比较失败
        const normalized = String(appData || '').replace(/\\/g, '/').replace(/\/+$/g, '');
        this.commandValidator.updateConfig({ allowedWorkingDirs: [normalized] });
      } catch {
        // ignore
      }
      
      this.isInitialized = true;
      return true;
    } catch (error) {
      console.warn('[ProcessSandbox] Not available:', error);
      return false;
    }
  }

  /**
   * 检查运行时环境
   */
  async checkEnvironment(runtime: 'python' | 'node'): Promise<EnvironmentCheckResult> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      
      const result = await invoke<TauriRuntimeCheckResult>('check_runtime_environment', {
        runtime,
      });

      return {
        runtime,
        available: result.available,
        version: result.version,
        path: result.path,
        error: result.error,
        installHint: result.install_hint,
        downloadUrl: result.download_url,
      };
    } catch (error) {
      return {
        runtime,
        available: false,
        error: error instanceof Error ? error.message : String(error),
        installHint: this.getInstallHint(runtime),
        downloadUrl: this.getDownloadUrl(runtime),
      };
    }
  }

  /**
   * 执行命令
   */
  async execute(
    options: ExecuteOptions, 
    context?: ExecutionContext
  ): Promise<ExecuteResult> {
    const startTime = Date.now();
    const execContext = context || this.createContext();

    // 注册执行
    const abortController = new AbortController();
    this.activeExecutions.set(execContext.executionId, abortController);

    try {
      // 触发开始事件
      this.events.onStart?.(execContext);

      // 前端预校验
      const validation = this.commandValidator.validateCommandWithPath(
        options.command + (options.args ? ' ' + options.args.join(' ') : ''),
        options.workingDir
      );

      if (!validation.valid) {
        const result: ExecuteResult = {
          success: false,
          exitCode: -1,
          stdout: '',
          stderr: '',
          duration: Date.now() - startTime,
          error: validation.reason || '命令校验失败',
          status: 'failed',
        };
        this.events.onError?.(new Error(result.error!), execContext);
        return result;
      }

      // 调用 Tauri 后端执行
      const { invoke } = await import('@tauri-apps/api/core');

      const tauriResult = await invoke<TauriShellResult>('run_safe_shell', {
        options: {
          execution_id: execContext.executionId,
          command: options.command,
          args: options.args || [],
          working_dir: options.workingDir,
          timeout_ms: options.timeoutMs || this.securityConfig.maxTimeout || 30000,
          env: options.env || {},
          max_output_size: this.securityConfig.maxOutputSize || 1024 * 1024,
          raw_last_arg: options.verbatimLastArg === true,
        },
      });

      const result: ExecuteResult = {
        success: tauriResult.success,
        exitCode: tauriResult.exit_code,
        stdout: tauriResult.stdout,
        stderr: tauriResult.stderr,
        duration: tauriResult.duration_ms,
        error: tauriResult.error,
        timedOut: tauriResult.timed_out === true,
        status: tauriResult.success ? 'completed'
          : (tauriResult.timed_out || tauriResult.error?.includes('超时')) ? 'timeout'
            : 'failed',
      };

      // 触发事件
      if (result.success) {
        this.events.onComplete?.(result, execContext);
      } else if (result.status === 'timeout') {
        this.events.onTimeout?.(execContext);
      } else {
        this.events.onError?.(new Error(result.error || 'Unknown error'), execContext);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const result: ExecuteResult = {
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: '',
        duration: Date.now() - startTime,
        error: errorMessage,
        status: 'failed',
      };

      this.events.onError?.(error instanceof Error ? error : new Error(errorMessage), execContext);
      return result;
    } finally {
      this.activeExecutions.delete(execContext.executionId);
    }
  }

  /**
   * Start a long-running process (dev server, watch, long build).
   *
   * Returns as soon as the child is spawned; output is read through
   * `readManagedProcess` and the process is stopped with `stopManagedProcess`.
   * This is what makes "run the site locally and check it" possible at all:
   * a blocking call would be killed by its own timeout.
   *
   * The process belongs to a conversation: it stays alive after the reply that
   * started it, and only that conversation can read or stop it.
   */
  async startManagedProcess(params: {
    executionId: string;
    conversationId: string;
    runId?: string;
    name?: string;
    command: string;
    args?: string[];
    workingDir?: string;
    env?: Record<string, string>;
    /** See CommandPlan.verbatimLastArg: `cmd /c "line"` needs an unescaped arg. */
    verbatimLastArg?: boolean;
  }): Promise<{ executionId: string; pid: number }> {
    const { invoke } = await import('@tauri-apps/api/core');
    const raw = await invoke<{ execution_id: string; pid: number }>('start_shell_process', {
      conversationId: params.conversationId,
      runId: params.runId,
      name: params.name,
      options: {
        execution_id: params.executionId,
        command: params.command,
        args: params.args || [],
        working_dir: params.workingDir,
        timeout_ms: this.securityConfig.maxTimeout || 30000,
        env: params.env || {},
        max_output_size: this.securityConfig.maxOutputSize || 1024 * 1024,
        raw_last_arg: params.verbatimLastArg === true,
      },
    });
    return { executionId: raw.execution_id, pid: raw.pid };
  }

  async readManagedProcess(executionId: string, limit?: number, conversationId?: string): Promise<ManagedProcessOutput> {
    const { invoke } = await import('@tauri-apps/api/core');
    const raw = await invoke<Record<string, unknown>>('read_shell_process', {
      executionId,
      conversationId,
      limit: limit ?? null,
    });
    return {
      executionId: String(raw.execution_id ?? executionId),
      running: Boolean(raw.running),
      exitCode: (raw.exit_code as number | null | undefined) ?? null,
      stdout: String(raw.stdout ?? ''),
      stderr: String(raw.stderr ?? ''),
      stdoutBytes: Number(raw.stdout_bytes ?? 0),
      stderrBytes: Number(raw.stderr_bytes ?? 0),
      stdoutDropped: Number(raw.stdout_dropped ?? 0),
      stderrDropped: Number(raw.stderr_dropped ?? 0),
    };
  }

  async stopManagedProcess(executionId: string, conversationId?: string): Promise<{ stopped: boolean; exitCode?: number | null }> {
    const { invoke } = await import('@tauri-apps/api/core');
    const raw = await invoke<{ stopped: boolean; exit_code?: number | null }>('stop_shell_process', {
      executionId,
      conversationId,
    });
    return { stopped: Boolean(raw?.stopped), exitCode: raw?.exit_code ?? null };
  }

  async listManagedProcesses(conversationId?: string): Promise<ManagedProcessSummary[]> {
    const { invoke } = await import('@tauri-apps/api/core');
    const rows = await invoke<Array<Record<string, unknown>>>('list_shell_processes', { conversationId });
    return (rows || []).map((raw) => ({
      executionId: String(raw.execution_id ?? ''),
      pid: Number(raw.pid ?? 0),
      command: String(raw.command ?? ''),
      workingDir: String(raw.working_dir ?? ''),
      name: raw.name ? String(raw.name) : undefined,
      conversationId: String(raw.conversation_id ?? ''),
      runId: raw.run_id ? String(raw.run_id) : undefined,
      running: Boolean(raw.running),
      exitCode: (raw.exit_code as number | null | undefined) ?? null,
      startedAt: Number(raw.started_at ?? 0),
      stdoutBytes: Number(raw.stdout_bytes ?? 0),
      stderrBytes: Number(raw.stderr_bytes ?? 0),
    }));
  }

  /**
   * Terminates every process a conversation started. Used when the session is
   * deleted, so a dev server cannot outlive the chat that launched it.
   */
  async stopConversationProcesses(conversationId: string): Promise<number> {
    const { invoke } = await import('@tauri-apps/api/core');
    const stopped = await invoke<number>('stop_conversation_processes', { conversationId });
    return Number(stopped ?? 0);
  }

  /**
   * 取消执行
   */
  async cancel(executionId: string): Promise<boolean> {
    const cancelled = await super.cancel(executionId);
    if (cancelled) {
      // 通知 Tauri 后端取消（如果支持）
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('cancel_safe_shell', { executionId });
      } catch {
        // ignore
      }
    }
    return cancelled;
  }

  /**
   * 获取安装提示
   */
  private getInstallHint(runtime: 'python' | 'node'): string {
    switch (runtime) {
      case 'python':
        return '请安装 Python 3.8 或更高版本';
      case 'node':
        return '请安装 Node.js 18 或更高版本';
      default:
        return '';
    }
  }

  /**
   * 获取下载链接
   */
  private getDownloadUrl(runtime: 'python' | 'node'): string {
    switch (runtime) {
      case 'python':
        return 'https://www.python.org/downloads/';
      case 'node':
        return 'https://nodejs.org/';
      default:
        return '';
    }
  }
}

/**
 * 创建 ProcessSandbox 实例
 */
export function createProcessSandbox(
  config?: SandboxSecurityConfig,
  events?: SandboxExecutorEvents
): ProcessSandbox {
  return new ProcessSandbox(config, events);
}

// 单例实例
let sandboxInstance: ProcessSandbox | null = null;

/**
 * 获取 ProcessSandbox 单例
 */
export function getProcessSandbox(): ProcessSandbox {
  if (!sandboxInstance) {
    sandboxInstance = new ProcessSandbox();
  }
  return sandboxInstance;
}

/**
 * 重置单例（用于测试）
 */
export function resetProcessSandbox(): void {
  if (sandboxInstance) {
    sandboxInstance.dispose();
    sandboxInstance = null;
  }
}

