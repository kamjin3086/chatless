/**
 * Sandbox 模块类型定义
 * 
 * 为 Skills 提供安全的执行环境
 */

/**
 * 执行器类型
 */
export type SandboxType = 'process' | 'wasm' | 'docker' | 'cloud';

/**
 * 执行状态
 */
export type ExecutionStatus = 
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'cancelled';

/**
 * 执行选项
 */
export interface ExecuteOptions {
  /** 要执行的命令 */
  command: string;
  /** 命令参数 */
  args?: string[];
  /** 工作目录 */
  workingDir?: string;
  /** 超时时间（毫秒），默认 30000 */
  timeoutMs?: number;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 是否捕获输出 */
  captureOutput?: boolean;
  /**
   * 最后一个参数不转义、由后端按原样加引号传入（Windows 上 `cmd /c "整行"` 需要）。
   * 见 `src/lib/shell/commandPlan.ts`。
   */
  verbatimLastArg?: boolean;
}

/**
 * 执行结果
 */
export interface ExecuteResult {
  /** 是否成功 */
  success: boolean;
  /** 退出码 */
  exitCode: number;
  /** 标准输出 */
  stdout: string;
  /** 标准错误 */
  stderr: string;
  /** 执行耗时（毫秒） */
  duration: number;
  /** 错误信息（如果失败） */
  error?: string;
  /** 是否因为超时被终止（此时 stdout/stderr 是终止前的输出） */
  timedOut?: boolean;
  /** 执行状态 */
  status: ExecutionStatus;
}

/**
 * 命令校验结果
 */
export interface ValidationResult {
  /** 是否通过校验 */
  valid: boolean;
  /** 不通过的原因 */
  reason?: string;
  /** 匹配到的危险模式 */
  matchedPattern?: string;
  /** 建议的安全替代命令 */
  suggestion?: string;
}

/**
 * 安全配置
 */
export interface SandboxSecurityConfig {
  /** 允许的命令白名单（正则表达式） */
  allowedCommands?: RegExp[];
  /** 禁止的命令黑名单（正则表达式） */
  blockedCommands?: RegExp[];
  /** 允许访问的路径 */
  allowedPaths?: string[];
  /** 禁止访问的路径 */
  blockedPaths?: string[];
  /** 是否允许网络访问 */
  allowNetwork?: boolean;
  /** 最大执行时间（毫秒） */
  maxTimeout?: number;
  /** 最大输出大小（字节） */
  maxOutputSize?: number;
}

/**
 * 执行上下文
 */
export interface ExecutionContext {
  /** 执行 ID */
  executionId: string;
  /** 技能 ID */
  skillId?: string;
  /** 会话 ID */
  conversationId?: string;
  /** 用户 ID */
  userId?: string;
  /** 开始时间 */
  startTime: number;
  /** 安全配置 */
  securityConfig?: SandboxSecurityConfig;
}

/**
 * 执行日志条目
 */
export interface ExecutionLogEntry {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: unknown;
}

/**
 * 环境检测结果
 */
export interface EnvironmentCheckResult {
  /** 运行时类型 */
  runtime: 'python' | 'node' | 'binary';
  /** 是否可用 */
  available: boolean;
  /** 版本号 */
  version?: string;
  /** 路径 */
  path?: string;
  /** 错误信息 */
  error?: string;
  /** 安装建议 */
  installHint?: string;
  /** 官方下载链接 */
  downloadUrl?: string;
}

/**
 * 默认安全配置
 */
export const DEFAULT_SECURITY_CONFIG: SandboxSecurityConfig = {
  allowedCommands: undefined, // 未设置则不使用白名单
  blockedCommands: [], // 由 CommandValidator 定义
  allowedPaths: [], // 由运行时确定
  blockedPaths: [], // 系统敏感路径
  allowNetwork: true,
  maxTimeout: 30000, // 30 秒
  maxOutputSize: 1024 * 1024, // 1MB
};

/**
 * 默认执行选项
 */
export const DEFAULT_EXECUTE_OPTIONS: Partial<ExecuteOptions> = {
  timeoutMs: 30000,
  captureOutput: true,
};
