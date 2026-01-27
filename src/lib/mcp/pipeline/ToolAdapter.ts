import type { ToolInvocation } from './ToolInvocation';

/**
 * ToolAdapter 只负责“执行”并返回结果，不负责 UI/卡片/follow-up。
 * 这些副作用统一由 ToolExecutionPipeline 处理。
 */
export interface ToolAdapter {
  readonly server: string;
  canHandle(invocation: ToolInvocation): boolean;
  execute(invocation: ToolInvocation): Promise<unknown>;
}

