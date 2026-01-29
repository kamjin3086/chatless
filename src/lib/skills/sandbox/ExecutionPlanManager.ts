/**
 * 执行计划管理器
 * 
 * 管理技能执行计划，提供进度追踪和状态管理
 * 
 * 灵感来源：Claude Cowork 的多步骤任务编排
 */

import type {
  ExecutionPlan,
  ExecutionStep,
  StepStatus,
  ProgressEvent,
  IProgressListener,
  ExecuteResult,
} from './types';

/**
 * 创建执行步骤的辅助函数
 */
export function createStep(
  id: string,
  name: string,
  options?: Partial<Omit<ExecutionStep, 'id' | 'name' | 'status'>>
): ExecutionStep {
  return {
    id,
    name,
    status: 'pending',
    ...options,
  };
}

/**
 * 创建执行计划的辅助函数
 */
export function createPlan(
  name: string,
  skillId: string,
  steps: ExecutionStep[],
  requiresApproval = false
): ExecutionPlan {
  return {
    id: `plan-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    name,
    skillId,
    steps,
    createdAt: Date.now(),
    status: 'draft',
    currentStepIndex: 0,
    requiresApproval,
    approved: !requiresApproval,
  };
}

/**
 * 执行计划管理器
 */
export class ExecutionPlanManager {
  private plans: Map<string, ExecutionPlan> = new Map();
  private listeners: Set<IProgressListener> = new Set();
  private activePlanId: string | null = null;

  /**
   * 添加进度监听器
   */
  addListener(listener: IProgressListener): void {
    this.listeners.add(listener);
  }

  /**
   * 移除进度监听器
   */
  removeListener(listener: IProgressListener): void {
    this.listeners.delete(listener);
  }

  /**
   * 注册执行计划
   */
  registerPlan(plan: ExecutionPlan): void {
    this.plans.set(plan.id, plan);
  }

  /**
   * 获取执行计划
   */
  getPlan(planId: string): ExecutionPlan | undefined {
    return this.plans.get(planId);
  }

  /**
   * 获取当前活动的计划
   */
  getActivePlan(): ExecutionPlan | undefined {
    return this.activePlanId ? this.plans.get(this.activePlanId) : undefined;
  }

  /**
   * 批准执行计划
   */
  approvePlan(planId: string): boolean {
    const plan = this.plans.get(planId);
    if (!plan) return false;

    plan.approved = true;
    plan.status = 'ready';
    return true;
  }

  /**
   * 开始执行计划
   */
  startPlan(planId: string): boolean {
    const plan = this.plans.get(planId);
    if (!plan) return false;

    if (plan.requiresApproval && !plan.approved) {
      console.warn('[ExecutionPlanManager] Plan requires approval before starting');
      return false;
    }

    plan.status = 'running';
    plan.startedAt = Date.now();
    plan.currentStepIndex = 0;
    this.activePlanId = planId;

    // 通知监听器
    this.notifyListeners('onPlanStart', plan);
    
    return true;
  }

  /**
   * 开始执行步骤
   */
  startStep(planId: string, stepId: string): boolean {
    const plan = this.plans.get(planId);
    if (!plan) return false;

    const step = plan.steps.find(s => s.id === stepId);
    if (!step) return false;

    // 检查依赖
    if (step.dependsOn && step.dependsOn.length > 0) {
      const depsCompleted = step.dependsOn.every(depId => {
        const depStep = plan.steps.find(s => s.id === depId);
        return depStep && depStep.status === 'completed';
      });

      if (!depsCompleted) {
        console.warn(`[ExecutionPlanManager] Step ${stepId} has incomplete dependencies`);
        return false;
      }
    }

    step.status = 'running';
    step.startedAt = Date.now();

    // 更新当前步骤索引
    const stepIndex = plan.steps.findIndex(s => s.id === stepId);
    if (stepIndex !== -1) {
      plan.currentStepIndex = stepIndex;
    }

    // 通知监听器
    this.notifyListeners('onStepStart', step, plan);
    this.emitProgress(plan);

    return true;
  }

  /**
   * 完成执行步骤
   */
  completeStep(planId: string, stepId: string, result: ExecuteResult): boolean {
    const plan = this.plans.get(planId);
    if (!plan) return false;

    const step = plan.steps.find(s => s.id === stepId);
    if (!step) return false;

    step.status = 'completed';
    step.completedAt = Date.now();
    step.result = result;

    // 通知监听器
    this.notifyListeners('onStepComplete', step, plan);
    this.emitProgress(plan);

    // 检查是否所有步骤都已完成
    const allCompleted = plan.steps.every(s => 
      s.status === 'completed' || s.status === 'skipped'
    );

    if (allCompleted) {
      this.completePlan(planId);
    }

    return true;
  }

  /**
   * 步骤执行失败
   */
  failStep(planId: string, stepId: string, error: Error): boolean {
    const plan = this.plans.get(planId);
    if (!plan) return false;

    const step = plan.steps.find(s => s.id === stepId);
    if (!step) return false;

    step.status = 'failed';
    step.completedAt = Date.now();
    step.error = error.message;

    // 通知监听器
    this.notifyListeners('onStepFailed', step, error, plan);

    // 如果步骤不可跳过，整个计划失败
    if (!step.skippable) {
      this.failPlan(planId, error);
    } else {
      this.emitProgress(plan);
    }

    return true;
  }

  /**
   * 跳过步骤
   */
  skipStep(planId: string, stepId: string): boolean {
    const plan = this.plans.get(planId);
    if (!plan) return false;

    const step = plan.steps.find(s => s.id === stepId);
    if (!step || !step.skippable) return false;

    step.status = 'skipped';
    step.completedAt = Date.now();

    this.emitProgress(plan);
    return true;
  }

  /**
   * 完成执行计划
   */
  private completePlan(planId: string): void {
    const plan = this.plans.get(planId);
    if (!plan) return;

    plan.status = 'completed';
    plan.completedAt = Date.now();
    
    if (this.activePlanId === planId) {
      this.activePlanId = null;
    }

    // 通知监听器
    this.notifyListeners('onPlanComplete', plan);
  }

  /**
   * 执行计划失败
   */
  private failPlan(planId: string, error: Error): void {
    const plan = this.plans.get(planId);
    if (!plan) return;

    plan.status = 'failed';
    plan.completedAt = Date.now();
    
    if (this.activePlanId === planId) {
      this.activePlanId = null;
    }

    // 通知监听器
    this.notifyListeners('onPlanFailed', plan, error);
  }

  /**
   * 取消执行计划
   */
  cancelPlan(planId: string): boolean {
    const plan = this.plans.get(planId);
    if (!plan) return false;

    plan.status = 'cancelled';
    plan.completedAt = Date.now();

    // 将所有待处理的步骤标记为跳过
    plan.steps.forEach(step => {
      if (step.status === 'pending' || step.status === 'running') {
        step.status = 'skipped';
      }
    });

    if (this.activePlanId === planId) {
      this.activePlanId = null;
    }

    return true;
  }

  /**
   * 删除执行计划
   */
  removePlan(planId: string): boolean {
    return this.plans.delete(planId);
  }

  /**
   * 获取计划进度信息
   */
  getProgress(planId: string): ProgressEvent | null {
    const plan = this.plans.get(planId);
    if (!plan) return null;

    const completedSteps = plan.steps.filter(s => 
      s.status === 'completed' || s.status === 'skipped'
    ).length;

    const currentStep = plan.steps[plan.currentStepIndex];
    if (!currentStep) return null;

    return {
      planId: plan.id,
      currentStep,
      totalSteps: plan.steps.length,
      completedSteps,
      progress: Math.round((completedSteps / plan.steps.length) * 100),
      estimatedRemainingMs: this.estimateRemainingTime(plan),
    };
  }

  /**
   * 估算剩余时间
   */
  private estimateRemainingTime(plan: ExecutionPlan): number | undefined {
    const completedSteps = plan.steps.filter(s => 
      s.status === 'completed' && s.startedAt && s.completedAt
    );

    if (completedSteps.length === 0) return undefined;

    // 计算平均步骤执行时间
    const totalDuration = completedSteps.reduce((sum, step) => {
      return sum + ((step.completedAt || 0) - (step.startedAt || 0));
    }, 0);
    const avgDuration = totalDuration / completedSteps.length;

    // 剩余步骤数
    const remainingSteps = plan.steps.filter(s => 
      s.status === 'pending' || s.status === 'running'
    ).length;

    return Math.round(avgDuration * remainingSteps);
  }

  /**
   * 发送进度事件
   */
  private emitProgress(plan: ExecutionPlan): void {
    const progress = this.getProgress(plan.id);
    if (progress) {
      this.notifyListeners('onProgress', progress);
    }
  }

  /**
   * 通知监听器
   */
  private notifyListeners(
    event: keyof IProgressListener,
    ...args: unknown[]
  ): void {
    this.listeners.forEach(listener => {
      const handler = listener[event];
      if (typeof handler === 'function') {
        try {
           
          (handler as (...args: unknown[]) => void).apply(listener, args);
        } catch (error) {
          console.error(`[ExecutionPlanManager] Listener error in ${event}:`, error);
        }
      }
    });
  }

  /**
   * 清理所有计划
   */
  clear(): void {
    this.plans.clear();
    this.activePlanId = null;
  }
}

// 单例实例
let managerInstance: ExecutionPlanManager | null = null;

/**
 * 获取执行计划管理器单例
 */
export function getExecutionPlanManager(): ExecutionPlanManager {
  if (!managerInstance) {
    managerInstance = new ExecutionPlanManager();
  }
  return managerInstance;
}

/**
 * 重置执行计划管理器（用于测试）
 */
export function resetExecutionPlanManager(): void {
  if (managerInstance) {
    managerInstance.clear();
  }
  managerInstance = null;
}

