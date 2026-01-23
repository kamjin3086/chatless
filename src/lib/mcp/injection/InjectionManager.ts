/**
 * MCP 注入策略管理器
 * 
 * ## 设计目标
 * 
 * 集中管理 MCP 提示词注入的时机判定和内容构建，
 * 统一初始调用和追问阶段的注入逻辑。
 * 
 * ## 核心功能
 * 
 * 1. **意图检测**: 分层检测用户是否需要 MCP 工具
 * 2. **提示词构建**: 根据阶段和上下文构建合适的提示词
 * 3. **状态管理**: 追踪会话级别的注入状态，避免重复
 * 4. **消息合并**: 减少 system 消息数量，提高指令清晰度
 */

import type { 
  InjectionContext, 
  InjectionResult, 
  InjectionDecision,
  ConversationInjectionState 
} from './types';
import { detectIntentSignals, makeInjectionDecision } from './intentDetector';
import { buildInitialPrompt, buildFollowUpPrompt } from './promptBuilder';

/**
 * 会话注入状态缓存
 */
const conversationStates = new Map<string, ConversationInjectionState>();

/**
 * 状态过期时间（30分钟）
 */
const STATE_EXPIRY_MS = 30 * 60 * 1000;

/**
 * MCP 注入管理器
 */
export class InjectionManager {
  /**
   * 执行注入
   * 
   * 统一入口，根据上下文自动选择注入策略
   */
  static async inject(context: InjectionContext): Promise<InjectionResult> {
    // 1. 检测意图信号
    const signals = detectIntentSignals(context.userContent, context.conversationId);
    
    // 2. 获取或更新会话状态
    if (context.conversationId) {
      const state = this.getConversationState(context.conversationId);
      signals.hasPreviousToolUse = state.initialToolsInjected;
    }
    
    // 3. 根据阶段选择策略
    switch (context.phase) {
      case 'initial':
        return this.injectInitial(context, signals);
      
      case 'followup':
      case 'retry':
        return this.injectFollowUp(context, signals);
      
      default:
        return { systemMessages: [], enabledServers: [], hasToolInfo: false };
    }
  }
  
  /**
   * 初始调用阶段注入
   */
  private static async injectInitial(
    context: InjectionContext,
    signals: ReturnType<typeof detectIntentSignals>
  ): Promise<InjectionResult> {
    // 做出注入决策
    const decision = makeInjectionDecision(signals);

    // 普通对话默认不注入工具（避免所有请求都携带 tools，导致“不支持 tools 的模型”连正常聊天都无法进行）
    if (!context.forceInject && !decision.shouldInject) {
      const messages: Array<{ role: 'system'; content: string }> = [];

      // 即使不注入 MCP/Skills，也注入时间上下文（必要时）
      try {
        const { buildTimeContextMessage, isTimeRelatedQuery } = await import('@/lib/prompts/TimeContext');
        const isTimeRelated = isTimeRelatedQuery(context.userContent);
        messages.push({ role: 'system', content: buildTimeContextMessage(isTimeRelated) });
      } catch {
        // ignore
      }

      return { systemMessages: messages, enabledServers: [], hasToolInfo: false };
    }

    // 构建初始提示词（按需注入工具与 skills 目录）
    const result = await buildInitialPrompt(context, signals);
    
    // 更新会话状态
    if (context.conversationId && result.hasToolInfo) {
      this.updateConversationState(context.conversationId, {
        initialToolsInjected: true,
        lastInjectedServers: result.enabledServers,
        toolCallDepth: 0
      });
    }
    
    return result;
  }
  
  /**
   * 追问阶段注入
   */
  private static async injectFollowUp(
    context: InjectionContext,
    signals: ReturnType<typeof detectIntentSignals>
  ): Promise<InjectionResult> {
    // 获取会话状态
    const state = context.conversationId 
      ? this.getConversationState(context.conversationId)
      : null;
    
    // 更新深度
    const depth = (state?.toolCallDepth ?? 0) + 1;
    if (context.conversationId) {
      this.updateConversationState(context.conversationId, {
        toolCallDepth: depth
      });
    }
    
    // 构建追问提示词
    const updatedContext: InjectionContext = {
      ...context,
      toolCallDepth: depth
    };
    
    return buildFollowUpPrompt(updatedContext, signals);
  }
  
  /**
   * 获取会话注入状态
   */
  private static getConversationState(conversationId: string): ConversationInjectionState {
    const now = Date.now();
    const existing = conversationStates.get(conversationId);
    
    // 检查过期
    if (existing && (now - existing.lastInjectionTime) > STATE_EXPIRY_MS) {
      conversationStates.delete(conversationId);
    }
    
    return conversationStates.get(conversationId) || {
      conversationId,
      initialToolsInjected: false,
      lastInjectedServers: [],
      toolCallDepth: 0,
      lastInjectionTime: now
    };
  }
  
  /**
   * 更新会话注入状态
   */
  private static updateConversationState(
    conversationId: string,
    updates: Partial<ConversationInjectionState>
  ): void {
    const existing = this.getConversationState(conversationId);
    conversationStates.set(conversationId, {
      ...existing,
      ...updates,
      lastInjectionTime: Date.now()
    });
    
    // 清理过期的状态
    this.cleanupExpiredStates();
  }
  
  /**
   * 清理过期的会话状态
   */
  private static cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [id, state] of conversationStates) {
      if ((now - state.lastInjectionTime) > STATE_EXPIRY_MS) {
        conversationStates.delete(id);
      }
    }
  }
  
  /**
   * 重置会话状态
   */
  static resetConversationState(conversationId: string): void {
    conversationStates.delete(conversationId);
  }
  
  /**
   * 检测是否需要注入（不执行注入）
   */
  static detectNeedInjection(content: string, conversationId?: string): InjectionDecision {
    const signals = detectIntentSignals(content, conversationId);
    return makeInjectionDecision(signals);
  }
}

/**
 * 便捷函数：执行初始注入
 */
export async function injectMcpPrompts(
  content: string,
  conversationId?: string,
  providerName?: string
): Promise<InjectionResult> {
  return InjectionManager.inject({
    userContent: content,
    conversationId,
    phase: 'initial',
    providerName
  });
}

/**
 * 便捷函数：执行追问阶段注入
 */
export async function injectFollowUpPrompts(
  originalQuestion: string,
  hasToolError?: boolean,
  conversationId?: string,
  depth?: number
): Promise<InjectionResult> {
  return InjectionManager.inject({
    userContent: '',
    originalQuestion,
    conversationId,
    phase: 'followup',
    hasToolError,
    toolCallDepth: depth
  });
}

