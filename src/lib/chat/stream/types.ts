/**
 * 流式处理核心类型定义
 */

import type { StreamEvent } from '@/lib/llm/types/stream-events';

export type OnToolCall = (params: {
  server: string;
  tool: string;
  args?: Record<string, unknown>;
  callId?: string;
  cardId: string;
  lockKey: string;
  /** 若提供，则表示无需真正执行工具，直接把该结果交给上层 AgentLoop 处理 */
  preResult?: unknown;
}) => Promise<void> | void;

/**
 * 流式处理上下文（线性委派架构）
 * 
 * 集中管理流式处理过程中的所有状态
 * 
 * ## 设计原则
 * 
 * - **最小化状态**: 只保留必要的状态，避免冗余
 * - **原始内容**: content保留原始内容（包括指令），用于解析
 * - **过滤下放**: 过滤逻辑在segments层，不在context层
 */
export interface StreamContext {
  /** 消息ID */
  messageId: string;
  /** 会话ID */
  conversationId: string;
  /** 累积的原始内容（包括工具调用指令，用于解析） */
  content: string;
  /** 是否已开始工具调用 */
  toolStarted: boolean;
  /** 思考开始时间 */
  thinkingStartTime: number;
  /** 当前FSM状态 */
  fsmState: 'RENDERING_BODY' | 'RENDERING_THINK' | 'TOOL_RUNNING' | 'TOOL_DONE';
  /** 是否已从 provider 事件流中接收过 thinking_* 事件（用于避免对 content_token 再做一次 <think> 解析导致重复） */
  hasProviderThinking?: boolean;
  /** 指令抑制阀（早阻断） */
  suppression?: {
    /** 为了早发现指令而保留的尾部缓冲（不会直接输出到UI） */
    buffer: string;
    /** 当前是否处于“指令抑制”状态 */
    active: boolean;
    /** JSON 大括号深度（用于检测 { ... } 是否闭合） */
    braceDepth: number;
    /** 是否已经在指令段中见到过 { */
    seenJsonStart: boolean;
    /** 抑制阈值：为了降低误判而保留的尾部窗口大小（默认 64） */
    guardWindow: number;
  };
  /** 元数据 */
  metadata: {
    provider: string;
    model: string;
    originalUserContent: string;
    historyForLlm: any[];
    /** AgentLoop：当存在时，tool_call 不会在 handler 内部直接递归续写 */
    onToolCall?: OnToolCall;
  };
}

/**
 * 事件处理器接口
 */
export interface EventHandler {
  /**
   * 判断是否可以处理该事件
   */
  canHandle(event: StreamEvent): boolean;
  
  /**
   * 处理事件
   */
  handle(event: StreamEvent, context: StreamContext): Promise<void> | void;
}

/**
 * 流式处理器配置
 */
export interface StreamOrchestratorConfig {
  /** 消息ID */
  messageId: string;
  /** 会话ID */
  conversationId: string;
  /** Provider */
  provider: string;
  /** 模型 */
  model: string;
  /** 原始用户内容 */
  originalUserContent: string;
  /** LLM 历史消息 */
  historyForLlm: any[];
  /** AgentLoop：拦截 tool_call，把执行/续写交给外部 while(true) loop */
  onToolCall?: OnToolCall;
  /** 更新UI的回调 */
  onUIUpdate?: (content: string) => void;
  /** 错误处理回调 */
  onError?: (error: Error) => void;
}

/**
 * 状态更新动作
 */
export type StateAction =
  | { type: 'CONTENT_APPEND'; chunk: string }
  | { type: 'THINKING_START'; timestamp: number }
  | { type: 'THINKING_APPEND'; chunk: string }
  | { type: 'THINKING_END' }
  | { type: 'TOOL_STARTED' }
  | { type: 'FSM_TRANSITION'; state: StreamContext['fsmState'] };

