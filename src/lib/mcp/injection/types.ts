/**
 * MCP 注入系统类型定义
 */

/**
 * 注入阶段
 */
export type InjectionPhase = 
  | 'initial'      // 初始调用
  | 'followup'     // 追问阶段（工具执行后）
  | 'retry';       // 重试阶段

/**
 * 注入决策结果
 */
export interface InjectionDecision {
  /** 是否应该注入 MCP 提示词 */
  shouldInject: boolean;
  /** 决策原因 */
  reason: InjectionReason;
  /** 检测到的意图信号 */
  signals: InjectionSignals;
}

/**
 * 注入决策原因
 */
export type InjectionReason = 
  | 'explicit_mention'      // 显式 @mention
  | 'web_search_enabled'    // 启用了网络搜索
  | 'tool_keywords'         // 包含工具相关关键词
  | 'previous_tool_use'     // 会话中有工具调用历史
  | 'followup_phase'        // 追问阶段需要工具上下文
  | 'no_signal';            // 无信号，不注入

/**
 * 意图检测信号
 */
export interface InjectionSignals {
  /** 是否有显式 @mention */
  hasExplicitMention: boolean;
  /** @mention 的服务器列表 */
  mentionedServers: string[];
  /** 是否启用网络搜索 */
  webSearchEnabled: boolean;
  /** 是否包含工具相关关键词 */
  hasToolKeywords: boolean;
  /** 是否有会话中的工具调用历史 */
  hasPreviousToolUse: boolean;
  /** 是否是时间相关查询 */
  isTimeRelated: boolean;
}

/**
 * 注入上下文
 */
export interface InjectionContext {
  /** 用户消息内容 */
  userContent: string;
  /** 当前会话 ID */
  conversationId?: string;
  /** 当前阶段 */
  phase: InjectionPhase;
  /** 原始用户问题（追问阶段使用） */
  originalQuestion?: string;
  /** 工具调用是否有错误（追问阶段使用） */
  hasToolError?: boolean;
  /** Provider 名称 */
  providerName?: string;
  /** 模型名称 */
  modelName?: string;
  /** 工具调用深度 */
  toolCallDepth?: number;
}

/**
 * 原生工具定义（用于传递给 LLM API）
 */
export interface NativeToolDefinition {
  name: string;
  description: string;
  parameters?: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * 注入结果
 */
export interface InjectionResult {
  /** 注入的 system 消息 */
  systemMessages: Array<{ role: 'system'; content: string }>;
  /** 启用的服务器列表 */
  enabledServers: string[];
  /** 是否注入了工具信息 */
  hasToolInfo: boolean;
  /** 是否应该使用原生工具调用 API */
  useNativeTools?: boolean;
  /** 原生工具定义列表（当 useNativeTools=true 时使用） */
  nativeTools?: NativeToolDefinition[];
  /** 工具调用策略详情 */
  toolCallStrategy?: {
    /** 是否使用原生工具调用 */
    useNative: boolean;
    /** 是否使用 Prompt 注入 */
    usePromptInjection: boolean;
    /** 最大工具数量 */
    maxTools: number;
    /** 是否支持并行工具调用 */
    parallelToolCalls: boolean;
    /** 是否支持流式工具调用返回 */
    streamingToolCalls: boolean;
    /** 备注 */
    note?: string;
  };
}

/**
 * 会话注入状态（用于避免重复注入）
 */
export interface ConversationInjectionState {
  /** 会话 ID */
  conversationId: string;
  /** 是否已注入初始工具信息 */
  initialToolsInjected: boolean;
  /** 上次注入的服务器列表 */
  lastInjectedServers: string[];
  /** 工具调用深度 */
  toolCallDepth: number;
  /** 上次注入时间 */
  lastInjectionTime: number;
}

