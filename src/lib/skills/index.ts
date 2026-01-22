/**
 * Skills 模块
 * 
 * 管理 Anthropic Skills 的加载、安装和配置
 * @see https://github.com/anthropics/skills
 */

// 类型导出
export type {
  Skill,
  SkillStatus,
  SkillDependency,
  DependencyType,
  SkillFrontmatter,
  SkillFilterOptions,
  SkillInstallOptions,
  SkillManagerConfig,
  RemoteSkillInfo,
  ISkillLoader,
  // 渐进式披露相关类型
  SkillIndexEntry,
  SkillHooks,
  SkillExtended,
  SkillExample,
  SkillExecutionContext,
  SkillExecutionResult,
  // 动作执行系统类型
  SkillRiskLevel,
  SkillActionType,
  ScriptRuntime,
  FileOperationType,
  SkillFileOperation,
  SkillAction,
  SkillActionStatus,
  SkillActionResult,
  PendingSkillAction,
  SkillActionExecutionContext,
  SkillExecutionPlan,
  SkillActionProgressEvent,
  ISkillActionListener,
} from './types';

// 解析器
export {
  parseSkillMd,
  extractDependencies,
  extractTitleFromContent,
  extractDescriptionFromContent,
  type SkillMdParseResult,
} from './SkillMdParser';

// 加载器
export {
  LocalSkillLoader,
  createLocalSkillLoader,
  type LocalSkillLoaderConfig,
} from './LocalSkillLoader';

export {
  RemoteSkillLoader,
  createRemoteSkillLoader,
  type RemoteSkillLoaderConfig,
} from './RemoteSkillLoader';

// 管理器
export {
  SkillManager,
  getSkillManager,
  resetSkillManager,
} from './SkillManager';

// 依赖检测
export {
  checkDependency,
  checkDependencies,
  updateSkillDependencyStatus,
  checkAllCommonDependencies,
  meetsVersionRequirement,
  // 增强功能
  clearDependencyCache,
  clearDependencyCacheFor,
  openDownloadUrl,
  getEnvironmentSummary,
  quickCheckRuntime,
  type DependencyCheckResult,
} from './dependencyChecker';

// 技能工具（用于渐进式披露）
export {
  skillTools,
  getSkillToolsSchema,
  executeSkillTool,
  isSkillTool,
  type SkillToolDefinition,
  type SkillToolParameter,
} from './skillTools';

// 技能执行器（Agent Loop）
export {
  SkillExecutor,
  getSkillExecutor,
  resetSkillExecutor,
  createExecutionContext,
  type ExecutionLogEntry,
  type SkillExecutionStatus,
  type SkillExecutorConfig,
} from './SkillExecutor';

// 技能验证器
export {
  validateSkillMd,
  isValidSkillMd,
  getValidationSummary,
  type SkillValidationResult,
  type ValidationIssue,
} from './SkillValidator';

// 沙箱执行器
export {
  // 类型
  type SandboxType,
  type ExecutionStatus,
  type ExecuteOptions,
  type ExecuteResult,
  type ValidationResult,
  type SandboxSecurityConfig,
  type ExecutionContext,
  type EnvironmentCheckResult,
  // 接口
  type ISandboxExecutor,
  type SandboxExecutorEvents,
  // 执行器
  ProcessSandbox,
  createProcessSandbox,
  getProcessSandbox,
  resetProcessSandbox,
  // 校验器
  CommandValidator,
  type CommandValidatorConfig,
} from './sandbox';

// 动作路由器
export {
  ActionRouter,
  getActionRouter,
  resetActionRouter,
  type IActionExecutor,
} from './ActionRouter';

// 技能编排器
export {
  SkillOrchestrator,
  getSkillOrchestrator,
  resetSkillOrchestrator,
  executeSkillAction,
  executeSkillActions,
  type SkillOrchestratorConfig,
} from './SkillOrchestrator';

