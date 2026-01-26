/**
 * Skill 编排器
 * 
 * 整合 Skill 动作的完整执行流程：
 * 1. 解析 SKILL.md 中定义的动作
 * 2. 管理动作执行顺序和依赖
 * 3. 协调审批流程
 * 4. 汇总执行结果
 */

import type {
  Skill,
  SkillAction,
  SkillActionResult,
  SkillActionExecutionContext,
  SkillExecutionPlan,
  SkillExecutionContext,
  SkillParameterValues,
  ISkillActionListener,
  SkillActionProgressEvent,
  PendingSkillAction,
  SkillActionStatus,
} from './types';
import { getActionRouter, type ActionRouter } from './ActionRouter';
import { getSkillManager } from './SkillManager';
import { 
  useSkillAuthStore, 
  createPendingSkillAction,
} from '@/store/skillAuthStore';

/**
 * 编排器配置
 */
export interface SkillOrchestratorConfig {
  /** 最大并行动作数 */
  maxParallelActions: number;
  /** 动作执行超时（毫秒） */
  actionTimeout: number;
  /** 是否在动作失败时停止 */
  stopOnError: boolean;
  /** 审批超时（毫秒） */
  approvalTimeout: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: SkillOrchestratorConfig = {
  maxParallelActions: 1,
  actionTimeout: 60000,
  stopOnError: true,
  approvalTimeout: 60000,
};

/**
 * Skill 编排器
 */
export class SkillOrchestrator {
  private config: SkillOrchestratorConfig;
  private router: ActionRouter;
  private listeners: Set<ISkillActionListener> = new Set();
  private activePlans: Map<string, SkillExecutionPlan> = new Map();

  constructor(config: Partial<SkillOrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.router = getActionRouter();
  }

  /**
   * 添加监听器
   */
  addListener(listener: ISkillActionListener): void {
    this.listeners.add(listener);
  }

  /**
   * 移除监听器
   */
  removeListener(listener: ISkillActionListener): void {
    this.listeners.delete(listener);
  }

  /**
   * 创建执行计划
   */
  createExecutionPlan(
    skill: Skill,
    actions: SkillAction[],
    context: SkillExecutionContext,
    parameters: SkillParameterValues = {}
  ): SkillExecutionPlan {
    const planId = `plan-${skill.id}-${Date.now()}`;
    
    const executionContext: SkillActionExecutionContext = {
      executionId: planId,
      skillId: skill.id,
      skillPath: skill.path,
      conversationId: context.conversationId,
      messageId: context.messageId,
      userContent: context.userContent,
      parameters,
      startTime: Date.now(),
    };

    const plan: SkillExecutionPlan = {
      id: planId,
      skillId: skill.id,
      skillName: skill.name,
      actions: [...actions],
      context: executionContext,
      status: 'draft',
      currentActionIndex: 0,
      results: [],
      createdAt: Date.now(),
      requiresApproval: actions.some(a => a.requiresApproval !== false),
      approved: false,
    };

    this.activePlans.set(planId, plan);
    return plan;
  }

  /**
   * 执行计划
   */
  async executePlan(plan: SkillExecutionPlan): Promise<SkillActionResult[]> {
    const results: SkillActionResult[] = [];
    
    try {
      // 更新计划状态
      plan.status = 'running';
      plan.startedAt = Date.now();
      
      // 通知监听器
      this.notifyPlanStart(plan);

      // 按顺序执行动作
      for (let i = 0; i < plan.actions.length; i++) {
        const action = plan.actions[i];
        plan.currentActionIndex = i;

        // 检查依赖
        if (action.dependsOn && action.dependsOn.length > 0) {
          const depsFailed = action.dependsOn.some(depId => {
            const depResult = results.find(r => r.actionId === depId);
            return !depResult || !depResult.success;
          });

          if (depsFailed) {
            const result: SkillActionResult = {
              actionId: action.id,
              success: false,
              status: 'skipped',
              error: '依赖的动作执行失败',
              duration: 0,
            };
            results.push(result);
            plan.results.push(result);
            continue;
          }
        }

        // 执行动作
        const result = await this.executeAction(action, plan);
        results.push(result);
        plan.results.push(result);

        // 通知进度
        this.notifyProgress(plan, action, i, results.length);

        // 检查是否需要停止
        if (!result.success && this.config.stopOnError && !action.skippable) {
          plan.status = 'failed';
          this.notifyPlanFailed(plan, new Error(result.error || '动作执行失败'));
          break;
        }
      }

      // 更新计划状态
      if (plan.status !== 'failed') {
        plan.status = 'completed';
        plan.completedAt = Date.now();
        this.notifyPlanComplete(plan);
      }

    } catch (error) {
      plan.status = 'failed';
      plan.completedAt = Date.now();
      this.notifyPlanFailed(plan, error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.activePlans.delete(plan.id);
    }

    return results;
  }

  /**
   * 执行单个动作
   */
  async executeAction(
    action: SkillAction,
    plan: SkillExecutionPlan
  ): Promise<SkillActionResult> {
    const { context } = plan;
    
    // 通知动作开始
    this.notifyActionStart(action, plan);

    // 解析命令和参数
    const { resolvedCommand, resolvedArgs } = this.router.resolveAction(
      action,
      context.parameters,
      context
    );

    // 检查是否需要审批
    const authStore = useSkillAuthStore.getState();
    const needsApproval = action.requiresApproval !== false && 
                          authStore.needsApproval(action);

    let finalResolvedCommand = resolvedCommand;

    if (needsApproval) {
      // 等待用户审批
      const approval = await this.waitForApproval(
        plan.skillId,
        plan.skillName,
        action,
        plan.context,
        resolvedCommand,
        resolvedArgs
      );

      if (!approval.approved) {
        const result: SkillActionResult = {
          actionId: action.id,
          success: false,
          status: 'rejected',
          error: '用户拒绝执行',
          duration: 0,
        };
        return result;
      }

      // 支持用户在审批阶段修改命令（仅影响本次执行）
      if (approval.modifiedCommand) {
        // 注意：此处只替换 command，不自动重写 args
        // UI 侧目前只提供对 command 的编辑入口。
        finalResolvedCommand = approval.modifiedCommand;
      }
    }

    // 执行动作
    const result = await this.router.execute(
      action,
      context,
      finalResolvedCommand,
      resolvedArgs
    );

    // 通知完成或失败
    if (result.success) {
      this.notifyActionComplete(action, result, plan);
    } else {
      this.notifyActionFailed(action, new Error(result.error || '执行失败'), plan);
    }

    return result;
  }

  /**
   * 等待用户审批
   */
  private async waitForApproval(
    skillId: string,
    skillName: string,
    action: SkillAction,
    context: SkillActionExecutionContext,
    resolvedCommand?: string,
    resolvedArgs?: string[]
  ): Promise<{ approved: boolean; modifiedCommand?: string }> {
    return new Promise((resolve) => {
      const authStore = useSkillAuthStore.getState();
      
      // 检查是否有缓存的用户选择
      const cachedChoice = authStore.getChoice(skillId, action.id);
      if (cachedChoice) {
        if (cachedChoice.action === 'allow_always') {
          resolve({ approved: true });
          return;
        } else if (cachedChoice.action === 'deny_always') {
          resolve({ approved: false });
          return;
        }
      }

      // 创建待审批动作
      const executionContext: SkillExecutionContext = {
        conversationId: context.conversationId,
        messageId: context.messageId,
        userContent: context.userContent,
        feedbacks: [],
        addFeedback: (msg) => { /* no-op */ },
      };

      const pendingAction = createPendingSkillAction(
        skillId,
        skillName,
        action,
        executionContext,
        {
          resolvedCommand,
          resolvedArgs,
          timeoutMs: this.config.approvalTimeout,
          onApprove: () => resolve({ approved: true }),
          onReject: () => resolve({ approved: false }),
          onModify: (modified) => {
            // 修改后执行也视为批准
            resolve({ approved: true, modifiedCommand: modified });
          },
        }
      );

      // 添加到 store
      authStore.addPendingAction(pendingAction);

      // 通知监听器
      this.notifyActionAwaitingApproval(pendingAction);

      // 设置超时
      setTimeout(() => {
        if (authStore.hasPendingAction(pendingAction.id)) {
          authStore.removePendingAction(pendingAction.id);
          resolve({ approved: false });
        }
      }, this.config.approvalTimeout);
    });
  }

  /**
   * 取消计划
   */
  cancelPlan(planId: string): boolean {
    const plan = this.activePlans.get(planId);
    if (!plan) {
      return false;
    }

    plan.status = 'cancelled';
    plan.completedAt = Date.now();
    this.activePlans.delete(planId);
    
    // 清除相关的待审批动作
    const authStore = useSkillAuthStore.getState();
    authStore.clearAllPendingActions();

    return true;
  }

  /**
   * 获取活跃的计划
   */
  getActivePlan(planId: string): SkillExecutionPlan | undefined {
    return this.activePlans.get(planId);
  }

  /**
   * 获取所有活跃的计划
   */
  getAllActivePlans(): SkillExecutionPlan[] {
    return Array.from(this.activePlans.values());
  }

  // ========== 通知方法 ==========

  private notifyPlanStart(plan: SkillExecutionPlan): void {
    for (const listener of this.listeners) {
      listener.onPlanStart?.(plan);
    }
  }

  private notifyActionStart(action: SkillAction, plan: SkillExecutionPlan): void {
    for (const listener of this.listeners) {
      listener.onActionStart?.(action, plan);
    }
  }

  private notifyActionAwaitingApproval(pending: PendingSkillAction): void {
    for (const listener of this.listeners) {
      listener.onActionAwaitingApproval?.(pending);
    }
  }

  private notifyActionComplete(
    action: SkillAction, 
    result: SkillActionResult, 
    plan: SkillExecutionPlan
  ): void {
    for (const listener of this.listeners) {
      listener.onActionComplete?.(action, result, plan);
    }
  }

  private notifyActionFailed(
    action: SkillAction, 
    error: Error, 
    plan: SkillExecutionPlan
  ): void {
    for (const listener of this.listeners) {
      listener.onActionFailed?.(action, error, plan);
    }
  }

  private notifyProgress(
    plan: SkillExecutionPlan, 
    action: SkillAction, 
    index: number, 
    completed: number
  ): void {
    const event: SkillActionProgressEvent = {
      planId: plan.id,
      currentAction: action,
      currentIndex: index,
      totalActions: plan.actions.length,
      completedActions: completed,
      progress: Math.round((completed / plan.actions.length) * 100),
      actionStatus: plan.results[index]?.status || 'running',
    };

    for (const listener of this.listeners) {
      listener.onProgress?.(event);
    }
  }

  private notifyPlanComplete(plan: SkillExecutionPlan): void {
    for (const listener of this.listeners) {
      listener.onPlanComplete?.(plan);
    }
  }

  private notifyPlanFailed(plan: SkillExecutionPlan, error: Error): void {
    for (const listener of this.listeners) {
      listener.onPlanFailed?.(plan, error);
    }
  }
}

// 单例实例
let orchestratorInstance: SkillOrchestrator | null = null;

/**
 * 获取 SkillOrchestrator 单例
 */
export function getSkillOrchestrator(
  config?: Partial<SkillOrchestratorConfig>
): SkillOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new SkillOrchestrator(config);
  }
  return orchestratorInstance;
}

/**
 * 重置 SkillOrchestrator（用于测试）
 */
export function resetSkillOrchestrator(): void {
  orchestratorInstance = null;
}

/**
 * 执行 Skill 动作
 * 
 * 便捷函数，用于快速执行一个 Skill 的动作
 */
export async function executeSkillAction(
  skillId: string,
  actionId: string,
  context: SkillExecutionContext,
  parameters: SkillParameterValues = {}
): Promise<SkillActionResult> {
  const manager = getSkillManager();
  const skill = await manager.getSkill(skillId);
  
  if (!skill) {
    return {
      actionId,
      success: false,
      status: 'failed',
      error: `Skill not found: ${skillId}`,
      duration: 0,
    };
  }

  // 解析 SKILL.md 获取动作
  const { parseSkillMd } = await import('./SkillMdParser');
  const parseResult = parseSkillMd(skill.skillMdContent || '');
  
  const action = parseResult.actions.find(a => a.id === actionId);
  if (!action) {
    return {
      actionId,
      success: false,
      status: 'failed',
      error: `Action not found: ${actionId}`,
      duration: 0,
    };
  }

  const orchestrator = getSkillOrchestrator();
  const plan = orchestrator.createExecutionPlan(skill, [action], context, parameters);
  const results = await orchestrator.executePlan(plan);
  
  return results[0] || {
    actionId,
    success: false,
    status: 'failed',
    error: 'No result returned',
    duration: 0,
  };
}

/**
 * 执行 Skill 的所有动作
 */
export async function executeSkillActions(
  skillId: string,
  context: SkillExecutionContext,
  parameters: SkillParameterValues = {}
): Promise<SkillActionResult[]> {
  const manager = getSkillManager();
  const skill = await manager.getSkill(skillId);
  
  if (!skill) {
    return [{
      actionId: 'unknown',
      success: false,
      status: 'failed',
      error: `Skill not found: ${skillId}`,
      duration: 0,
    }];
  }

  // 解析 SKILL.md 获取所有动作
  const { parseSkillMd } = await import('./SkillMdParser');
  const parseResult = parseSkillMd(skill.skillMdContent || '');
  
  if (parseResult.actions.length === 0) {
    // 如果没有定义 actions，返回 skill 内容作为指令
    return [{
      actionId: 'instruction',
      success: true,
      status: 'completed',
      output: parseResult.content,
      stdout: parseResult.content,
      duration: 0,
    }];
  }

  const orchestrator = getSkillOrchestrator();
  const plan = orchestrator.createExecutionPlan(skill, parseResult.actions, context, parameters);
  return orchestrator.executePlan(plan);
}

