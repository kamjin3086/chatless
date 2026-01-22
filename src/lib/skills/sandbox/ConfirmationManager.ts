/**
 * 用户确认管理器
 * 
 * 实现 Human-in-the-loop 机制，在执行敏感操作前请求用户确认
 * 
 * 灵感来源：Claude Cowork 的协作模式
 */

import type {
  ConfirmationRequest,
  ConfirmationResult,
  IConfirmationHandler,
  ConfirmationPolicy,
  RiskLevel,
} from './types';
import { DEFAULT_CONFIRMATION_POLICY } from './types';

/**
 * 用户选择记录
 */
interface UserChoice {
  command: string;
  action: 'allow_always' | 'deny';
  createdAt: number;
  expiresAt: number;
}

/**
 * 确认管理器
 * 
 * 职责：
 * 1. 管理用户确认请求
 * 2. 缓存用户的"始终允许"选择
 * 3. 协调确认 UI 的显示
 */
export class ConfirmationManager {
  private handler: IConfirmationHandler | null = null;
  private policy: ConfirmationPolicy;
  private userChoices: Map<string, UserChoice> = new Map();
  private pendingRequests: Map<string, ConfirmationRequest> = new Map();

  constructor(policy?: Partial<ConfirmationPolicy>) {
    this.policy = { ...DEFAULT_CONFIRMATION_POLICY, ...policy };
  }

  /**
   * 设置确认处理器
   */
  setHandler(handler: IConfirmationHandler): void {
    this.handler = handler;
  }

  /**
   * 更新策略
   */
  updatePolicy(policy: Partial<ConfirmationPolicy>): void {
    this.policy = { ...this.policy, ...policy };
  }

  /**
   * 检查操作是否需要确认
   */
  needsConfirmation(riskLevel: RiskLevel): boolean {
    return this.policy.requireConfirmationFor.includes(riskLevel);
  }

  /**
   * 请求用户确认
   * 
   * @param command 要执行的命令
   * @param riskLevel 风险等级
   * @param description 风险描述
   * @param impact 潜在影响列表
   * @returns 确认结果
   */
  async requestConfirmation(
    command: string,
    riskLevel: RiskLevel,
    description: string,
    impact: string[],
    suggestion?: string
  ): Promise<ConfirmationResult> {
    // 检查是否已有"始终允许"的选择
    const cachedChoice = this.getCachedChoice(command);
    if (cachedChoice) {
      if (cachedChoice.action === 'allow_always') {
        return { confirmed: true, action: 'allow_always' };
      } else if (cachedChoice.action === 'deny') {
        return { confirmed: false, action: 'deny' };
      }
    }

    // 如果没有处理器，默认拒绝高风险操作
    if (!this.handler) {
      console.warn('[ConfirmationManager] No handler set, denying risky operation');
      return {
        confirmed: riskLevel === 'safe' || riskLevel === 'low',
        action: riskLevel === 'safe' || riskLevel === 'low' ? 'allow' : 'deny',
      };
    }

    // 创建确认请求
    const requestId = `confirm-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const request: ConfirmationRequest = {
      requestId,
      command,
      riskLevel,
      description,
      impact,
      suggestion,
      createdAt: Date.now(),
      timeoutMs: this.policy.confirmationTimeoutMs,
    };

    this.pendingRequests.set(requestId, request);

    try {
      // 发起确认请求
      const result = await Promise.race([
        this.handler.requestConfirmation(request),
        this.createTimeoutPromise(request.timeoutMs),
      ]);

      // 如果用户选择"始终允许"，缓存选择
      if (this.policy.rememberChoices && result.action === 'allow_always') {
        this.cacheChoice(command, 'allow_always');
      }

      return result;
    } finally {
      this.pendingRequests.delete(requestId);
    }
  }

  /**
   * 取消所有待处理的确认请求
   */
  cancelAllPending(): void {
    if (this.handler) {
      for (const requestId of this.pendingRequests.keys()) {
        this.handler.cancelConfirmation(requestId);
      }
    }
    this.pendingRequests.clear();
  }

  /**
   * 清除缓存的用户选择
   */
  clearChoices(): void {
    this.userChoices.clear();
  }

  /**
   * 获取缓存的用户选择
   */
  private getCachedChoice(command: string): UserChoice | null {
    const choice = this.userChoices.get(this.normalizeCommand(command));
    if (!choice) return null;

    // 检查是否过期
    if (Date.now() > choice.expiresAt) {
      this.userChoices.delete(this.normalizeCommand(command));
      return null;
    }

    return choice;
  }

  /**
   * 缓存用户选择
   */
  private cacheChoice(command: string, action: 'allow_always' | 'deny'): void {
    const normalizedCmd = this.normalizeCommand(command);
    this.userChoices.set(normalizedCmd, {
      command: normalizedCmd,
      action,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.policy.choiceExpiryMs,
    });
  }

  /**
   * 标准化命令（用于缓存键）
   */
  private normalizeCommand(command: string): string {
    // 提取命令的基本结构，忽略具体参数值
    return command.trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase();
  }

  /**
   * 创建超时 Promise
   */
  private createTimeoutPromise(timeoutMs: number): Promise<ConfirmationResult> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          confirmed: false,
          action: 'timeout',
          feedback: '确认请求超时',
        });
      }, timeoutMs);
    });
  }
}

/**
 * 默认确认处理器（控制台输出，用于开发/调试）
 */
export class ConsoleConfirmationHandler implements IConfirmationHandler {
  async requestConfirmation(request: ConfirmationRequest): Promise<ConfirmationResult> {
    console.warn(
      `[Security] 敏感操作确认请求:\n` +
      `  命令: ${request.command}\n` +
      `  风险等级: ${request.riskLevel}\n` +
      `  描述: ${request.description}\n` +
      `  影响: ${request.impact.join(', ')}\n` +
      `  建议: ${request.suggestion || '无'}`
    );
    
    // 在非交互环境中默认拒绝
    return {
      confirmed: false,
      action: 'deny',
      feedback: '非交互环境，默认拒绝',
    };
  }

  cancelConfirmation(requestId: string): void {
    console.info(`[Security] 确认请求已取消: ${requestId}`);
  }
}

// 单例实例
let managerInstance: ConfirmationManager | null = null;

/**
 * 获取确认管理器单例
 */
export function getConfirmationManager(): ConfirmationManager {
  if (!managerInstance) {
    managerInstance = new ConfirmationManager();
    // 设置默认处理器
    managerInstance.setHandler(new ConsoleConfirmationHandler());
  }
  return managerInstance;
}

/**
 * 重置确认管理器（用于测试）
 */
export function resetConfirmationManager(): void {
  if (managerInstance) {
    managerInstance.cancelAllPending();
    managerInstance.clearChoices();
  }
  managerInstance = null;
}

