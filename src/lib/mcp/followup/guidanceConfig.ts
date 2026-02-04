import type { GuidanceRule } from './types';

/**
 * 规则集：用于"工具结果→下一步动作"的统一指引。
 *
 * 设计原则：
 * - 大部分引导现在通过 AgentLoopRunner.buildGuidanceSystemMessage() 以 system 消息形式注入
 * - 这里仅保留用于 FollowUpDispatcher（非 AgentLoop 路径）的兼容规则
 * - 规则返回空字符串表示"不需要额外引导"（避免与 system 消息重复）
 *
 * 注意：
 * - 规则中不应包含工具名（如 skill__use）等内部细节，否则可能被 LLM 泄露给用户
 * - 详细的工具间协调引导已迁移到 AgentLoopRunner 的 system 消息注入机制
 */
export const DEFAULT_GUIDANCE_RULES: GuidanceRule[] = [
  // 连接问题：允许直接重试
  {
    id: 'generic_connection_error_retry',
    priority: 1000,
    match: { kind: 'connection_error' },
    guidance: () => '', // 由 AgentLoop 的 system 消息处理
  },

  // 工具失败：纠错后重试或换工具
  {
    id: 'generic_tool_error_fix_or_switch',
    priority: 900,
    match: { kind: 'tool_error' },
    guidance: () => '', // 由 AgentLoop 的 system 消息处理
  },

  // 空结果：调整参数再试
  {
    id: 'generic_empty_result_adjust',
    priority: 800,
    match: { kind: 'empty' },
    guidance: () => '', // 由 AgentLoop 的 system 消息处理
  },

  // 默认：成功则继续或回答
  {
    id: 'generic_success_answer_or_continue',
    priority: 0,
    match: { kind: 'success' },
    guidance: () => '', // 由 AgentLoop 的 system 消息处理
  },
];
