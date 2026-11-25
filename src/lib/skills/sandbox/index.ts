/**
 * Sandbox - the pre-flight layer in front of command execution.
 *
 * What lives here: command validation (deny-list plus the working-directory allowlist,
 * `CommandValidator`) and the process plumbing that hands a validated command to the
 * backend.
 *
 * What deliberately does not live here: whether a call needs the user's approval - that is
 * the approval card in `ToolExecutionPipeline` (ADR-0001) - and the filesystem boundary,
 * enforced by the Rust allowlist (ADR-0004). The human-in-the-loop confirmation and the
 * execution-plan tracking that this header used to advertise belonged to the parallel skill
 * execution engine and were deleted with it (#237); neither is this module's job.
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
  type ManagedProcessOutput,
  type ManagedProcessSummary,
  createProcessSandbox,
  getProcessSandbox,
  resetProcessSandbox,
} from './ProcessSandbox';


