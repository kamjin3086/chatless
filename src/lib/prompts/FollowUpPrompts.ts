/**
 * 追问阶段专用提示词
 * 
 * ## 重构说明
 * 
 * 此文件已重构为与 InjectionManager 集成。
 * 保留原有的导出接口以确保向后兼容性。
 * 
 * ## 设计原则
 * 
 * 1. 精简高效：追问阶段不需要重复所有初始调用的规则
 * 2. 聚焦目标：明确告知模型当前任务（基于工具结果回答）
 * 3. 减少干扰：避免提供过多工具调用指导，优先引导直接回答
 */

import { injectFollowUpPrompts } from '@/lib/mcp/injection';

/**
 * 第一次追问：工具执行完成后的初次追问
 * 目标：引导模型基于工具结果直接给出答案
 * 
 * @param originalQuestion - 用户原始问题
 * @param hasError - 工具调用是否失败
 * @param enabledServers - 可用的服务器列表（向后兼容，新实现不使用）
 * @param includeToolContext - 是否包含工具上下文（向后兼容，新实现不使用）
 */
export function buildFirstFollowUpPrompt(
  originalQuestion: string, 
  hasError?: boolean,
  _enabledServers?: string[],
  _includeToolContext?: boolean
): string {
  if (hasError) {
    return `工具调用遇到问题。请基于错误信息处理：

【处理策略】：
1. 参数错误：调整参数后重新调用（只输出 1 个工具调用）
2. 连接错误：直接重试（系统会自动重连）
3. 工具不可用：尝试其他工具
4. 无法解决：基于已有知识回答

【重要】如果需要重试工具调用，只输出 1 个 <use_mcp_tool> 标签，然后停止。

用户问题：${originalQuestion}`;
  }
  
  return `工具调用已完成，请基于返回的结果回答用户问题。

【核心要求】：
1. 阅读上面的工具调用结果
2. 直接输出中文答案，简洁明了
3. 不要再输出任何工具调用指令

【禁止行为】：
- 禁止输出 <use_mcp_tool> 或任何工具调用标签
- 禁止重复调用已经执行过的工具

用户问题：${originalQuestion}`;
}

/**
 * 第二次追问（轻量追问）：第一次追问失败后的强制追问
 * 目标：更强硬地要求模型直接回答，禁止工具调用
 */
export function buildSecondFollowUpPrompt(originalQuestion: string): string {
  return `【最终回答 - 禁止工具调用】

你已经获得了所有需要的信息。现在必须给出最终答案。

强制要求：
1. 阅读上面的工具调用结果，总结关键信息
2. 直接输出中文答案
3. 绝对禁止输出 <use_mcp_tool> 或任何工具调用指令

用户问题：${originalQuestion}

现在直接回答（不要调用任何工具）：`;
}

/**
 * 精简的工具描述（仅在真正需要时提供）
 * 只包含最核心的信息，用于第一次追问阶段
 * 
 * @deprecated 使用 InjectionManager 代替
 */
export function buildMinimalToolContext(enabledServers: string[]): string[] {
  const messages: string[] = [];
  
  if (enabledServers.length > 0) {
    const list = enabledServers.length > 3 
      ? `${enabledServers.slice(0, 3).join(', ')} (+${enabledServers.length - 3} more)` 
      : enabledServers.join(', ');
    messages.push(`可用工具: ${list}`);
  }
  
  messages.push(`如需调用工具: <use_mcp_tool><server_name>...</server_name><tool_name>...</tool_name><arguments>{...}</arguments></use_mcp_tool>`);
  
  return messages;
}

/**
 * 构建追问阶段的完整system消息
 * 
 * 使用新的 InjectionManager 实现，保持接口兼容。
 * 
 * @param stage - 追问阶段：'first' | 'second'
 * @param originalQuestion - 用户原始问题
 * @param enabledServers - 可用的服务器列表（向后兼容）
 * @param includeToolContext - 是否包含工具上下文（向后兼容）
 * @param hasError - 工具调用是否失败
 */
export async function buildFollowUpSystemMessages(
  stage: 'first' | 'second',
  originalQuestion: string,
  _enabledServers: string[] = [],
  _includeToolContext: boolean = true,
  hasError?: boolean
): Promise<Array<{ role: 'system'; content: string }>> {
  // 使用新的注入管理器
  const depth = stage === 'first' ? 1 : 2;
  const result = await injectFollowUpPrompts(
    originalQuestion,
    hasError,
    undefined, // conversationId 由调用方管理
    depth
  );
  
  return result.systemMessages;
}

/**
 * 同步版本（向后兼容）
 * 
 * @deprecated 建议使用异步版本 buildFollowUpSystemMessages
 */
export function buildFollowUpSystemMessagesSync(
  stage: 'first' | 'second',
  originalQuestion: string,
  _enabledServers: string[] = [],
  _includeToolContext: boolean = true,
  hasError?: boolean
): Array<{ role: 'system'; content: string }> {
  const messages: Array<{ role: 'system'; content: string }> = [];
  
  // 简化的时间上下文
  try {
    const { buildSimpleTimeContext, isTimeRelatedQuery } = require('@/lib/prompts/TimeContext');
    if (isTimeRelatedQuery(originalQuestion)) {
      messages.push({ role: 'system', content: buildSimpleTimeContext() });
    }
  } catch {
    // 忽略错误
  }
  
  if (stage === 'first') {
    messages.push({ 
      role: 'system', 
      content: buildFirstFollowUpPrompt(originalQuestion, hasError) 
    });
  } else {
    messages.push({ 
      role: 'system', 
      content: buildSecondFollowUpPrompt(originalQuestion) 
    });
  }
  
  return messages;
}

/**
 * 追问阶段的设计哲学
 * 
 * ## 为什么要精简？
 * 
 * 1. **减少token消耗**：追问阶段不需要重复所有初始规则
 * 2. **提高理解度**：过多规则反而让模型confused，不知道优先级
 * 3. **聚焦当前任务**：工具已执行完成，现在只需要"总结回答"
 * 4. **避免误导**：详细的工具调用指导反而鼓励模型再次调用工具
 * 
 * ## 两阶段策略
 * 
 * - **第一次追问**：温和引导，允许在结果不足时调用工具
 * - **第二次追问**：强制回答，完全禁止工具调用
 * 
 * ## 对比初始调用
 * 
 * | 阶段 | System消息数量 | 包含内容 |
 * |------|---------------|----------|
 * | 初始调用 | 3-5条 | 工具描述、协议规则 |
 * | 第一次追问 | 1-2条 | 核心任务指令 |
 * | 第二次追问 | 1条 | 强制回答指令 |
 */
