import type { Message as LlmMessage } from '@/lib/llm/types';

export type AgentLoopRuntimeHooks = {
  onAgentStart?: (info: { assistantMessageId: string; conversationId: string }) => void | Promise<void>;
  onAgentEnd?: (info: { assistantMessageId: string; conversationId: string }) => void | Promise<void>;
  onStreamStart?: (info: { assistantMessageId: string; conversationId: string; round: number }) => void | Promise<void>;
  onStreamEvent?: (event: unknown, info: { assistantMessageId: string; conversationId: string; round: number }) => void;
  onStreamComplete?: (info: { assistantMessageId: string; conversationId: string; round: number }) => void | Promise<void>;
  onStreamError?: (
    error: Error,
    info: { assistantMessageId: string; conversationId: string; round: number }
  ) => void | Promise<void>;
};

export type AgentLoopRunParams = {
  assistantMessageId: string;
  conversationId: string;
  provider: string;
  model: string;
  /** 不包含本次 assistant 消息的历史（通常截止到本次 user 输入） */
  historyForLlm: LlmMessage[];
  originalUserContent: string;
  /** Optional prior run whose completed events should be supplied as context for a new run. */
  continuationRunId?: string;
  continuationPrompt?: string;
  /** A regeneration reuses recorded context but may only produce an answer. */
  regenerate?: boolean;
  /** 透传给 provider 的 options（温度/最大tokens/会话参数等） */
  options?: Record<string, unknown>;
  /** Planning mode permits bounded reads/searches but blocks side effects. */
  planOnly?: boolean;
  /** UI/监控侧 hook：用于复用 useChatActions 的超时监控、性能监控、token 计数等 */
  runtimeHooks?: AgentLoopRuntimeHooks;
};

export type AgentLoopCancelParams = {
  assistantMessageId: string;
};

