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
  error?: string;
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
   * 检查执行器是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
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
        this.commandValidator.updateConfig({ allowedWorkingDirs: [appData] });
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
          command: options.command,
          args: options.args || [],
          working_dir: options.workingDir,
          timeout_ms: options.timeoutMs || this.securityConfig.maxTimeout || 30000,
          env: options.env || {},
          max_output_size: this.securityConfig.maxOutputSize || 1024 * 1024,
        },
      });

      const result: ExecuteResult = {
        success: tauriResult.success,
        exitCode: tauriResult.exit_code,
        stdout: tauriResult.stdout,
        stderr: tauriResult.stderr,
        duration: tauriResult.duration_ms,
        error: tauriResult.error,
        status: tauriResult.success ? 'completed' : 
                tauriResult.error?.includes('超时') ? 'timeout' : 'failed',
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
   * 取消执行
   */
  async cancel(executionId: string): Promise<boolean> {
    const cancelled = await super.cancel(executionId);
    if (cancelled) {
      // 通知 Tauri 后端取消（如果支持）
      // 目前后端使用超时机制，暂不支持主动取消
      console.info(`[ProcessSandbox] Cancelled execution: ${executionId}`);
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

