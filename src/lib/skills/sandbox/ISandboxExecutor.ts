/**
 * 沙箱执行器接口
 * 
 * 定义统一的执行器接口，便于未来扩展到不同的隔离方案：
 * - ProcessSandbox: 进程级隔离（MVP）
 * - WasmSandbox: WebAssembly 沙箱（阶段二）
 * - DockerSandbox: Docker 容器隔离（阶段三）
 * - CloudSandbox: 云端托管执行（可选）
 */

import type {
  SandboxType,
  ExecuteOptions,
  ExecuteResult,
  ExecutionContext,
  SandboxSecurityConfig,
  EnvironmentCheckResult,
} from './types';

/**
 * 沙箱执行器接口
 */
export interface ISandboxExecutor {
  /**
   * 执行器类型
   */
  readonly type: SandboxType;

  /**
   * 执行器名称
   */
  readonly name: string;

  /**
   * 检查执行器是否可用
   * 
   * @returns 是否可用
   */
  isAvailable(): Promise<boolean>;

  /**
   * 获取环境信息
   * 
   * @param runtime - 运行时类型
   * @returns 环境检测结果
   */
  checkEnvironment(runtime: 'python' | 'node'): Promise<EnvironmentCheckResult>;

  /**
   * 执行命令
   * 
   * @param options - 执行选项
   * @param context - 执行上下文
   * @returns 执行结果
   */
  execute(options: ExecuteOptions, context?: ExecutionContext): Promise<ExecuteResult>;

  /**
   * 取消执行
   * 
   * @param executionId - 执行 ID
   * @returns 是否成功取消
   */
  cancel(executionId: string): Promise<boolean>;

  /**
   * 获取安全配置
   */
  getSecurityConfig(): SandboxSecurityConfig;

  /**
   * 更新安全配置
   * 
   * @param config - 部分安全配置
   */
  updateSecurityConfig(config: Partial<SandboxSecurityConfig>): void;

  /**
   * 清理资源
   */
  dispose(): Promise<void>;
}

/**
 * 执行器工厂接口
 */
export interface ISandboxExecutorFactory {
  /**
   * 创建执行器实例
   * 
   * @param type - 执行器类型
   * @param config - 安全配置
   * @returns 执行器实例
   */
  create(type: SandboxType, config?: SandboxSecurityConfig): ISandboxExecutor;

  /**
   * 获取可用的执行器类型
   * 
   * @returns 可用的执行器类型列表
   */
  getAvailableTypes(): Promise<SandboxType[]>;

  /**
   * 获取推荐的执行器类型
   * 
   * 根据当前环境自动选择最佳执行器
   * 
   * @returns 推荐的执行器类型
   */
  getRecommendedType(): Promise<SandboxType>;
}

/**
 * 执行器事件
 */
export interface SandboxExecutorEvents {
  /**
   * 执行开始
   */
  onStart?: (context: ExecutionContext) => void;

  /**
   * 执行完成
   */
  onComplete?: (result: ExecuteResult, context: ExecutionContext) => void;

  /**
   * 执行失败
   */
  onError?: (error: Error, context: ExecutionContext) => void;

  /**
   * 输出更新
   */
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr', context: ExecutionContext) => void;

  /**
   * 执行超时
   */
  onTimeout?: (context: ExecutionContext) => void;

  /**
   * 执行取消
   */
  onCancel?: (context: ExecutionContext) => void;
}

/**
 * 抽象基类：提供通用实现
 */
export abstract class BaseSandboxExecutor implements ISandboxExecutor {
  abstract readonly type: SandboxType;
  abstract readonly name: string;
  
  protected securityConfig: SandboxSecurityConfig;
  protected events: SandboxExecutorEvents;
  protected activeExecutions: Map<string, AbortController> = new Map();

  constructor(config?: SandboxSecurityConfig, events?: SandboxExecutorEvents) {
    this.securityConfig = config || {
      maxTimeout: 30000,
      maxOutputSize: 1024 * 1024,
      allowNetwork: true,
    };
    this.events = events || {};
  }

  abstract isAvailable(): Promise<boolean>;
  abstract checkEnvironment(runtime: 'python' | 'node'): Promise<EnvironmentCheckResult>;
  abstract execute(options: ExecuteOptions, context?: ExecutionContext): Promise<ExecuteResult>;

  async cancel(executionId: string): Promise<boolean> {
    const controller = this.activeExecutions.get(executionId);
    if (controller) {
      controller.abort();
      this.activeExecutions.delete(executionId);
      return true;
    }
    return false;
  }

  getSecurityConfig(): SandboxSecurityConfig {
    return { ...this.securityConfig };
  }

  updateSecurityConfig(config: Partial<SandboxSecurityConfig>): void {
    this.securityConfig = { ...this.securityConfig, ...config };
  }

  async dispose(): Promise<void> {
    // 取消所有活跃的执行
    for (const [executionId] of this.activeExecutions) {
      await this.cancel(executionId);
    }
    this.activeExecutions.clear();
  }

  /**
   * 生成唯一执行 ID
   */
  protected generateExecutionId(): string {
    return `exec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * 创建执行上下文
   */
  protected createContext(
    skillId?: string,
    conversationId?: string
  ): ExecutionContext {
    return {
      executionId: this.generateExecutionId(),
      skillId,
      conversationId,
      startTime: Date.now(),
      securityConfig: this.securityConfig,
    };
  }
}

