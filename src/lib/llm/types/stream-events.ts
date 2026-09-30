/**
 * LLM流式输出的结构化事件类型
 * 
 * 用于在Provider、Tokenizer、Store、UI之间传递数据
 * 完全解耦具体的thinking模式实现
 */

/**
 * 流事件类型
 */
export type StreamEventType = 
  | 'thinking_start'    // 思考开始
  | 'thinking_token'    // 思考内容token
  | 'thinking_end'      // 思考结束
  | 'content_token'     // 正常内容token
  | 'tool_call'         // 工具调用
  | 'stream_complete';  // 流结束

/**
 * 基础流事件
 */
export interface BaseStreamEvent {
  type: StreamEventType;
  timestamp?: number;
}

/**
 * 思考开始事件
 */
export interface ThinkingStartEvent extends BaseStreamEvent {
  type: 'thinking_start';
  /** 思考模式标识（可选，用于UI个性化） */
  mode?: 'standard' | 'ollama' | 'deepseek' | 'chain-of-thought';
}

/**
 * 思考token事件
 */
export interface ThinkingTokenEvent extends BaseStreamEvent {
  type: 'thinking_token';
  /** 思考内容片段 */
  content: string;
}

/**
 * 思考结束事件
 */
export interface ThinkingEndEvent extends BaseStreamEvent {
  type: 'thinking_end';
}

/**
 * 内容token事件
 */
export interface ContentTokenEvent extends BaseStreamEvent {
  type: 'content_token';
  /** 内容片段 */
  content: string;
}

/**
 * 工具调用事件
 */
export interface ToolCallEvent extends BaseStreamEvent {
  type: 'tool_call';
  /** 工具调用的完整内容 */
  toolCall: string;
  /** 解析后的工具信息（可选） */
  parsed?: {
    serverName?: string;
    toolName?: string;
    arguments?: string;
  };
  /** Lossless provider payload needed when replaying this tool turn. */
  providerData?: Record<string, unknown>;
}

/**
 * 流完成事件
 */
export interface StreamCompleteEvent extends BaseStreamEvent {
  type: 'stream_complete';
}

/**
 * 流事件联合类型
 */
export type StreamEvent = 
  | ThinkingStartEvent
  | ThinkingTokenEvent
  | ThinkingEndEvent
  | ContentTokenEvent
  | ToolCallEvent
  | StreamCompleteEvent;

/**
 * 流事件回调
 */
export interface StreamEventCallbacks {
  onEvent?: (event: StreamEvent) => void;
  onStart?: () => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
}

/**
 * 创建流事件的工具函数
 */
export const createStreamEvent = {
  thinkingStart: (mode?: ThinkingStartEvent['mode']): ThinkingStartEvent => ({
    type: 'thinking_start',
    mode,
    timestamp: Date.now()
  }),
  
  thinkingToken: (content: string): ThinkingTokenEvent => ({
    type: 'thinking_token',
    content,
    timestamp: Date.now()
  }),
  
  thinkingEnd: (): ThinkingEndEvent => ({
    type: 'thinking_end',
    timestamp: Date.now()
  }),
  
  contentToken: (content: string): ContentTokenEvent => ({
    type: 'content_token',
    content,
    timestamp: Date.now()
  }),
  
  toolCall: (
    toolCall: string,
    parsed?: ToolCallEvent['parsed'],
    providerData?: ToolCallEvent['providerData']
  ): ToolCallEvent => ({
    type: 'tool_call',
    toolCall,
    parsed,
    providerData,
    timestamp: Date.now()
  }),
  
  streamComplete: (): StreamCompleteEvent => ({
    type: 'stream_complete',
    timestamp: Date.now()
  })
};

