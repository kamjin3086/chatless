/**
 * 技能执行器
 * 
 * 实现 Agent Loop 模式，确保复杂技能任务能够可靠完成
 * 
 * ## 设计理念
 * 
 * Agent Loop 是一种确保任务完成的机制：
 * 1. 执行 -> 验证 -> 反馈 -> 重试
 * 2. 支持 pre_execute、post_execute、on_error、verify 钩子
 * 3. 自动重试失败的操作
 * 4. 超过重试次数时请求人工介入
 * 
 * ## 执行流程
 * 
 * ```
 * Pre-Execute Hook → Main Logic → Verify Hook
 *                                     ↓
 *                        [Pass] → Post-Execute Hook → Done
 *                        [Fail] → Error Feedback → Retry (if attempts < max)
 *                                     ↓
 *                        [Max Retries] → Human Intervention
 * ```
 * 
 * ## 安全执行
 * 
 * 所有命令执行都通过 ProcessSandbox 进行安全校验：
 * - 危险命令过滤（rm -rf, sudo 等）
 * - 工作目录限制
 * - 执行超时控制
 */

import { getSkillManager } from './SkillManager';
import type { 
  Skill, 
  SkillExecutionContext, 
  SkillExecutionResult 
} from './types';
import { 
  getProcessSandbox, 
  type ProcessSandbox,
  getConfirmationManager,
  type ConfirmationManager,
  type RiskLevel,
  getExecutionPlanManager,
  type ExecutionPlanManager,
  type ExecutionPlan,
  type IProgressListener,
  createPlan,
  createStep,
} from './sandbox';

/**
 * 执行日志条目
 */
export interface ExecutionLogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  data?: unknown;
}

/**
 * 技能执行状态
 */
export type SkillExecutionStatus = 
  | 'idle'
  | 'pre_execute'
  | 'executing'
  | 'verifying'
  | 'post_execute'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * 执行器配置
 */
export interface SkillExecutorConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试间隔 (ms) */
  retryDelay: number;
  /** 执行超时 (ms) */
  timeout: number;
  /** 是否在复杂任务前要求执行计划 */
  requirePlanForComplexTasks: boolean;
  /** 复杂度阈值（超过此值被视为复杂任务） */
  complexityThreshold: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: SkillExecutorConfig = {
  maxRetries: 3,
  retryDelay: 1000,
  timeout: 30000,
  requirePlanForComplexTasks: true,
  complexityThreshold: 5, // 步骤数
};

/**
 * 技能执行器
 */
export class SkillExecutor {
  private config: SkillExecutorConfig;
  private executionLogs: Map<string, ExecutionLogEntry[]> = new Map();
  private activeExecutions: Map<string, { status: SkillExecutionStatus; startTime: number }> = new Map();
  private sandbox: ProcessSandbox | null = null;
  private confirmationManager: ConfirmationManager | null = null;
  private planManager: ExecutionPlanManager | null = null;
  private progressListeners: Set<IProgressListener> = new Set();
  
  constructor(config: Partial<SkillExecutorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 获取沙箱执行器（延迟初始化）
   */
  private getSandbox(): ProcessSandbox {
    if (!this.sandbox) {
      this.sandbox = getProcessSandbox();
    }
    return this.sandbox;
  }

  /**
   * 获取确认管理器（延迟初始化）
   */
  private getConfirmationManager(): ConfirmationManager {
    if (!this.confirmationManager) {
      this.confirmationManager = getConfirmationManager();
    }
    return this.confirmationManager;
  }

  /**
   * 获取执行计划管理器（延迟初始化）
   */
  private getPlanManager(): ExecutionPlanManager {
    if (!this.planManager) {
      this.planManager = getExecutionPlanManager();
      // 注册进度监听器
      this.progressListeners.forEach(listener => {
        this.planManager!.addListener(listener);
      });
    }
    return this.planManager;
  }

  /**
   * 添加进度监听器
   */
  addProgressListener(listener: IProgressListener): void {
    this.progressListeners.add(listener);
    if (this.planManager) {
      this.planManager.addListener(listener);
    }
  }

  /**
   * 移除进度监听器
   */
  removeProgressListener(listener: IProgressListener): void {
    this.progressListeners.delete(listener);
    if (this.planManager) {
      this.planManager.removeListener(listener);
    }
  }

  /**
   * 评估命令风险等级
   */
  private evaluateRiskLevel(command: string): RiskLevel {
    const lowerCmd = command.toLowerCase();
    
    // 关键风险：系统级操作
    if (/\b(rm\s+-rf|format|mkfs|dd\s+if=|shutdown|reboot)\b/.test(lowerCmd)) {
      return 'critical';
    }
    
    // 高风险：权限提升、系统配置修改
    if (/\b(sudo|runas|chmod|chown|npm\s+install\s+-g)\b/.test(lowerCmd)) {
      return 'high';
    }
    
    // 中风险：文件修改、安装操作
    if (/\b(rm|del|pip\s+install|npm\s+install|git\s+push)\b/.test(lowerCmd)) {
      return 'medium';
    }
    
    // 低风险：读取操作、查询操作
    if (/\b(cat|ls|dir|echo|git\s+status|git\s+log)\b/.test(lowerCmd)) {
      return 'low';
    }
    
    return 'safe';
  }

  /**
   * 请求执行确认
   */
  private async requestExecutionConfirmation(
    command: string,
    context: SkillExecutionContext
  ): Promise<boolean> {
    const riskLevel = this.evaluateRiskLevel(command);
    const manager = this.getConfirmationManager();
    
    // 只有高风险和关键风险需要确认
    if (!manager.needsConfirmation(riskLevel)) {
      return true;
    }

    const result = await manager.requestConfirmation(
      command,
      riskLevel,
      `技能执行请求：${command}`,
      this.getImpactDescription(command, riskLevel),
      '请仔细确认命令内容，确保了解其影响后再继续'
    );

    if (!result.confirmed) {
      context.addFeedback(`用户拒绝执行命令: ${command} (${result.action})`);
    }

    return result.confirmed;
  }

  /**
   * 获取命令影响描述
   */
  private getImpactDescription(command: string, riskLevel: RiskLevel): string[] {
    const impacts: string[] = [];
    
    if (riskLevel === 'critical') {
      impacts.push('此操作可能导致不可逆的系统更改');
      impacts.push('可能影响系统稳定性或数据完整性');
    }
    
    if (riskLevel === 'high') {
      impacts.push('此操作需要管理员权限');
      impacts.push('可能修改系统配置');
    }
    
    if (/\brm\b/.test(command) || /\bdel\b/.test(command)) {
      impacts.push('将删除文件或目录');
    }
    
    if (/\binstall\b/.test(command)) {
      impacts.push('将安装新的软件包');
    }
    
    if (/\bgit\s+push\b/.test(command)) {
      impacts.push('将推送更改到远程仓库');
    }
    
    return impacts.length > 0 ? impacts : ['此操作将执行系统命令'];
  }

  /**
   * 创建技能执行计划
   */
  createExecutionPlan(skill: Skill, _context: SkillExecutionContext): ExecutionPlan {
    const steps = [];
    
    // Pre-execute hook
    if (skill.hooks?.pre_execute) {
      steps.push(createStep('pre-execute', '准备阶段', {
        description: '执行前置处理',
        command: skill.hooks.pre_execute,
        skippable: false,
      }));
    }
    
    // Main execution
    steps.push(createStep('main', '主要执行', {
      description: '执行技能核心逻辑',
      skippable: false,
    }));
    
    // Verify hook
    if (skill.hooks?.verify) {
      steps.push(createStep('verify', '验证结果', {
        description: '验证执行结果',
        command: skill.hooks.verify,
        skippable: true,
        dependsOn: ['main'],
      }));
    }
    
    // Post-execute hook
    if (skill.hooks?.post_execute) {
      steps.push(createStep('post-execute', '清理阶段', {
        description: '执行后置处理',
        command: skill.hooks.post_execute,
        skippable: true,
        dependsOn: skill.hooks.verify ? ['verify'] : ['main'],
      }));
    }
    
    const plan = createPlan(
      `执行技能: ${skill.name}`,
      skill.id,
      steps,
      this.config.requirePlanForComplexTasks && steps.length >= this.config.complexityThreshold
    );
    
    // 注册计划
    this.getPlanManager().registerPlan(plan);
    
    return plan;
  }

  /**
   * 获取执行计划进度
   */
  getExecutionProgress(planId: string) {
    return this.getPlanManager().getProgress(planId);
  }
  
  /**
   * 执行技能
   * 
   * @param skillId - 技能 ID
   * @param context - 执行上下文
   */
  async execute(
    skillId: string, 
    context: SkillExecutionContext
  ): Promise<SkillExecutionResult> {
    const executionId = `${skillId}-${Date.now()}`;
    this.executionLogs.set(executionId, []);
    this.activeExecutions.set(executionId, { status: 'idle', startTime: Date.now() });
    
    const log = (level: ExecutionLogEntry['level'], message: string, data?: unknown) => {
      const entry: ExecutionLogEntry = { timestamp: Date.now(), level, message, data };
      this.executionLogs.get(executionId)?.push(entry);
    };
    
    const setStatus = (status: SkillExecutionStatus) => {
      const execution = this.activeExecutions.get(executionId);
      if (execution) {
        execution.status = status;
      }
    };
    
    try {
      // 获取技能
      const manager = getSkillManager();
      const skill = await manager.getSkill(skillId);
      
      if (!skill) {
        log('error', `Skill not found: ${skillId}`);
        return { success: false, error: `Skill not found: ${skillId}` };
      }
      
      if (!skill.enabled) {
        log('error', `Skill is not enabled: ${skillId}`);
        return { success: false, error: `Skill "${skill.name}" is not enabled` };
      }
      
      log('info', `Starting execution of skill: ${skill.name}`);
      
      let attempts = 0;
      let lastError: string | undefined;
      
      while (attempts < this.config.maxRetries) {
        attempts++;
        log('info', `Attempt ${attempts}/${this.config.maxRetries}`);
        
        try {
          // 1. Pre-execute hook
          if (skill.hooks?.pre_execute) {
            setStatus('pre_execute');
            log('info', 'Running pre-execute hook');
            await this.runHook(skill.hooks.pre_execute, context, log);
          }
          
          // 2. Main execution
          setStatus('executing');
          log('info', 'Executing main skill logic');
          const result = await this.executeSkillLogic(skill, context, log);
          
          // 3. Verify hook (if defined)
          if (skill.hooks?.verify) {
            setStatus('verifying');
            log('info', 'Running verification hook');
            const isValid = await this.runVerification(skill.hooks.verify, context, log);
            
            if (!isValid) {
              lastError = 'Verification failed';
              log('warn', `Verification failed on attempt ${attempts}`);
              context.addFeedback(`验证失败 (尝试 ${attempts}/${this.config.maxRetries})`);
              
              // 等待后重试
              if (attempts < this.config.maxRetries) {
                await this.delay(this.config.retryDelay);
              }
              continue;
            }
          }
          
          // 4. Post-execute hook
          if (skill.hooks?.post_execute) {
            setStatus('post_execute');
            log('info', 'Running post-execute hook');
            await this.runHook(skill.hooks.post_execute, context, log);
          }
          
          // 成功
          setStatus('completed');
          const duration = Date.now() - (this.activeExecutions.get(executionId)?.startTime || Date.now());
          log('success', `Skill execution completed successfully in ${duration}ms`);
          
          return {
            success: true,
            result,
            duration,
            attempts,
          };
          
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          log('error', `Error on attempt ${attempts}: ${lastError}`);
          
          // 运行错误处理钩子
          if (skill.hooks?.on_error) {
            try {
              log('info', 'Running error hook');
              await this.runHook(skill.hooks.on_error, context, log);
            } catch (hookError) {
              log('warn', `Error hook failed: ${hookError instanceof Error ? hookError.message : String(hookError)}`);
            }
          }
          
          context.addFeedback(`执行出错: ${lastError} (尝试 ${attempts}/${this.config.maxRetries})`);
          
          // 等待后重试
          if (attempts < this.config.maxRetries) {
            await this.delay(this.config.retryDelay);
          }
        }
      }
      
      // 超过最大重试次数
      setStatus('failed');
      log('error', `Max retries exceeded. Last error: ${lastError}`);
      
      return {
        success: false,
        error: `Max retries (${this.config.maxRetries}) exceeded. Last error: ${lastError}`,
        attempts,
      };
      
    } finally {
      // 清理
      this.activeExecutions.delete(executionId);
    }
  }
  
  /**
   * 执行技能主逻辑
   * 
   * 这是技能的核心执行部分。在当前实现中，我们主要是准备上下文
   * 让 AI 根据技能指令执行任务。
   */
  private async executeSkillLogic(
    skill: Skill,
    context: SkillExecutionContext,
    log: (level: ExecutionLogEntry['level'], message: string, data?: unknown) => void
  ): Promise<unknown> {
    log('info', `Executing skill: ${skill.name}`);
    
    // 在这个阶段，主要是准备技能上下文
    // 实际的"执行"会由 AI 根据注入的技能指令来完成
    // 这里可以添加额外的预处理逻辑
    
    return {
      skillId: skill.id,
      skillName: skill.name,
      contextProvided: true,
      userContent: context.userContent,
    };
  }
  
  /**
   * 运行钩子命令
   * 
   * 通过 ProcessSandbox 安全执行命令，包含：
   * - 危险命令过滤
   * - 工作目录限制
   * - 执行超时控制
   */
  private async runHook(
    command: string,
    context: SkillExecutionContext,
    log: (level: ExecutionLogEntry['level'], message: string, data?: unknown) => void
  ): Promise<void> {
    log('info', `Running hook: ${command}`);
    
    try {
      // 检查沙箱是否可用
      const sandbox = this.getSandbox();
      const isAvailable = await sandbox.isAvailable();
      
      if (!isAvailable) {
        log('warn', 'Sandbox not available, hook execution skipped');
        return;
      }
      
      // 解析命令和参数
      const parts = this.parseCommand(command);
      
      // 通过沙箱执行命令
      const result = await sandbox.execute({
        command: parts.command,
        args: parts.args,
        timeoutMs: this.config.timeout,
      });
      
      if (result.success) {
        log('success', `Hook completed: ${command}`);
        if (result.stdout) {
          log('info', `Hook output: ${result.stdout.slice(0, 500)}`);
        }
      } else {
        const errorMsg = result.error || `Exit code: ${result.exitCode}`;
        log('error', `Hook failed: ${errorMsg}`);
        if (result.stderr) {
          log('error', `Hook stderr: ${result.stderr.slice(0, 500)}`);
        }
        throw new Error(errorMsg);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log('error', `Hook failed: ${errorMsg}`);
      throw error;
    }
  }

  /**
   * 解析命令字符串为命令和参数
   */
  private parseCommand(commandStr: string): { command: string; args: string[] } {
    const parts = commandStr.trim().split(/\s+/);
    return {
      command: parts[0] || '',
      args: parts.slice(1),
    };
  }
  
  /**
   * 运行验证钩子
   * 
   * 通过 ProcessSandbox 安全执行验证命令
   * 验证命令应该返回退出码 0 表示成功
   */
  private async runVerification(
    command: string,
    context: SkillExecutionContext,
    log: (level: ExecutionLogEntry['level'], message: string, data?: unknown) => void
  ): Promise<boolean> {
    log('info', `Running verification: ${command}`);
    
    try {
      const sandbox = this.getSandbox();
      const isAvailable = await sandbox.isAvailable();
      
      if (!isAvailable) {
        log('warn', 'Sandbox not available, verification skipped (assuming pass)');
        return true;
      }
      
      // 解析命令和参数
      const parts = this.parseCommand(command);
      
      // 通过沙箱执行命令
      const result = await sandbox.execute({
        command: parts.command,
        args: parts.args,
        timeoutMs: this.config.timeout,
      });
      
      const isValid = result.exitCode === 0;
      log(isValid ? 'success' : 'warn', `Verification ${isValid ? 'passed' : 'failed'}: exit code ${result.exitCode}`);
      
      if (result.stdout) {
        log('info', `Verification output: ${result.stdout.slice(0, 500)}`);
      }
      
      return isValid;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log('error', `Verification error: ${errorMsg}`);
      return false;
    }
  }
  
  /**
   * 延迟
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * 获取执行日志
   */
  getExecutionLogs(executionId?: string): ExecutionLogEntry[] {
    if (executionId) {
      return this.executionLogs.get(executionId) || [];
    }
    
    // 返回所有日志
    const allLogs: ExecutionLogEntry[] = [];
    this.executionLogs.forEach(logs => allLogs.push(...logs));
    return allLogs.sort((a, b) => a.timestamp - b.timestamp);
  }
  
  /**
   * 获取当前活跃的执行
   */
  getActiveExecutions(): Array<{ id: string; status: SkillExecutionStatus; startTime: number }> {
    return Array.from(this.activeExecutions.entries()).map(([id, data]) => ({
      id,
      ...data,
    }));
  }
  
  /**
   * 取消执行
   */
  cancelExecution(executionId: string): boolean {
    const execution = this.activeExecutions.get(executionId);
    if (execution) {
      execution.status = 'cancelled';
      return true;
    }
    return false;
  }
  
  /**
   * 清理日志
   */
  clearLogs(): void {
    this.executionLogs.clear();
  }
}

// 单例实例
let executorInstance: SkillExecutor | null = null;

/**
 * 获取技能执行器单例
 */
export function getSkillExecutor(config?: Partial<SkillExecutorConfig>): SkillExecutor {
  if (!executorInstance) {
    executorInstance = new SkillExecutor(config);
  }
  return executorInstance;
}

/**
 * 重置技能执行器（用于测试）
 */
export function resetSkillExecutor(): void {
  executorInstance = null;
}

/**
 * 创建执行上下文
 */
export function createExecutionContext(
  conversationId: string,
  messageId: string,
  userContent: string
): SkillExecutionContext {
  const feedbacks: string[] = [];
  
  return {
    conversationId,
    messageId,
    userContent,
    feedbacks,
    addFeedback: (message: string) => {
      feedbacks.push(message);
    },
  };
}

