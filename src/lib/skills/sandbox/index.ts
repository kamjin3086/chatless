/**
 * Sandbox 模块
 * 
 * 为 Skills 提供安全的命令执行环境
 * 
 * ## 主要特性
 * 
 * 1. **命令安全校验** - 阻止危险命令执行
 * 2. **工作目录限制** - 仅允许访问应用数据目录
 * 3. **执行超时控制** - 防止命令长时间阻塞
 * 4. **用户确认机制** - Human-in-the-loop，敏感操作需用户确认
 * 5. **执行计划管理** - 多步骤任务的进度追踪
 */

// 类型导出
export * from './types';

// 接口导出
export { 
  type ISandboxExecutor, 
  type ISandboxExecutorFactory,
  type SandboxExecutorEvents,
  BaseSandboxExecutor,
} from './ISandboxExecutor';

// 校验器导出
export { 
  CommandValidator,
  type CommandValidatorConfig,
} from './validators';

// 执行器导出
export { 
  ProcessSandbox, 
  createProcessSandbox,
  getProcessSandbox,
  resetProcessSandbox,
} from './ProcessSandbox';

// 确认管理器导出
export {
  ConfirmationManager,
  ConsoleConfirmationHandler,
  getConfirmationManager,
  resetConfirmationManager,
} from './ConfirmationManager';

// 执行计划管理器导出
export {
  ExecutionPlanManager,
  createStep,
  createPlan,
  getExecutionPlanManager,
  resetExecutionPlanManager,
} from './ExecutionPlanManager';

