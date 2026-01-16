/**
 * MCP 注入系统
 * 
 * ## 模块职责
 * 
 * 统一管理 MCP 提示词的注入时机和内容构建。
 * 
 * ## 主要导出
 * 
 * - **InjectionManager**: 核心管理器类
 * - **injectMcpPrompts**: 初始调用注入的便捷函数
 * - **injectFollowUpPrompts**: 追问阶段注入的便捷函数
 * - **detectAndDecide**: 检测并决策是否需要注入
 * 
 * ## 使用示例
 * 
 * ```typescript
 * import { injectMcpPrompts, InjectionManager } from '@/lib/mcp/injection';
 * 
 * // 方式1：使用便捷函数
 * const result = await injectMcpPrompts(userContent, conversationId);
 * 
 * // 方式2：使用管理器类
 * const result = await InjectionManager.inject({
 *   userContent,
 *   conversationId,
 *   phase: 'initial'
 * });
 * 
 * // 检测是否需要注入
 * const decision = InjectionManager.detectNeedInjection(content);
 * if (decision.shouldInject) {
 *   console.log(`需要注入，原因: ${decision.reason}`);
 * }
 * ```
 */

// 类型导出
export type {
  InjectionPhase,
  InjectionDecision,
  InjectionReason,
  InjectionSignals,
  InjectionContext,
  InjectionResult,
  ConversationInjectionState
} from './types';

// 核心管理器
export { 
  InjectionManager,
  injectMcpPrompts,
  injectFollowUpPrompts
} from './InjectionManager';

// 意图检测
export {
  detectIntentSignals,
  makeInjectionDecision,
  detectAndDecide
} from './intentDetector';

// 提示词构建器（高级用法）
export {
  buildInitialPrompt,
  buildFollowUpPrompt
} from './promptBuilder';

