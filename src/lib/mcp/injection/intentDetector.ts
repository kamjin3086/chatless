/**
 * 意图检测器
 * 
 * ## 设计目标
 * 
 * 从用户消息中检测是否需要 MCP 工具的意图信号。
 * 采用分层检测策略，提高准确性并减少误判。
 * 
 * ## 检测优先级
 * 
 * 1. 显式 @mention（最高优先级）
 * 2. 网络搜索开关
 * 3. 会话工具调用历史
 * 4. 关键词匹配（最低优先级）
 */

import type { InjectionSignals, InjectionDecision } from './types';
import { useWebSearchStore } from '@/store/webSearchStore';

/**
 * @mention 正则表达式
 */
const MENTION_PATTERN = /@([a-zA-Z0-9_-]{1,64})/g;

/**
 * 工具相关关键词（精简版）
 * 只保留高置信度的关键词，减少误判
 */
const TOOL_KEYWORDS_PATTERN = /\b(文件|目录|列出|搜索|查询|运行|执行|调用工具|mcp\b|tool\b)/i;

/**
 * 时间相关查询检测
 */
const TIME_RELATED_PATTERNS = [
  /今天|明天|昨天|现在|当前|最新|最近|这周|本周|这个月|本月|今年/,
  /today|tomorrow|yesterday|now|current|latest|recent|this week|this month|this year/i,
  /\d{4}[年/-]\d{1,2}[月/-]\d{1,2}/,
  /天气|新闻|股价|汇率|比赛|直播/
];

/**
 * 检测用户消息中的意图信号
 */
export function detectIntentSignals(content: string, _conversationId?: string): InjectionSignals {
  // 1. 检测显式 @mention
  const mentionedServers: string[] = [];
  const mentionMatches = content.matchAll(MENTION_PATTERN);
  for (const match of mentionMatches) {
    const serverName = match[1];
    if (serverName && !mentionedServers.includes(serverName)) {
      mentionedServers.push(serverName);
    }
  }
  
  // 2. 检测网络搜索开关
  let webSearchEnabled = false;
  try {
    webSearchEnabled = !!useWebSearchStore.getState().isWebSearchEnabled;
  } catch {
    // 忽略错误
  }
  
  // 3. 检测工具关键词
  const hasToolKeywords = TOOL_KEYWORDS_PATTERN.test(content);
  
  // 4. 检测时间相关查询
  const isTimeRelated = TIME_RELATED_PATTERNS.some(pattern => pattern.test(content));
  
  return {
    hasExplicitMention: mentionedServers.length > 0,
    mentionedServers,
    webSearchEnabled,
    hasToolKeywords,
    hasPreviousToolUse: false, // 由调用方设置
    isTimeRelated
  };
}

/**
 * 根据信号做出注入决策
 */
export function makeInjectionDecision(signals: InjectionSignals): InjectionDecision {
  // 优先级 1：显式 @mention
  if (signals.hasExplicitMention) {
    return {
      shouldInject: true,
      reason: 'explicit_mention',
      signals
    };
  }
  
  // 优先级 2：网络搜索已启用
  if (signals.webSearchEnabled) {
    return {
      shouldInject: true,
      reason: 'web_search_enabled',
      signals
    };
  }
  
  // 优先级 3：会话中有工具调用历史
  if (signals.hasPreviousToolUse) {
    return {
      shouldInject: true,
      reason: 'previous_tool_use',
      signals
    };
  }
  
  // 优先级 4：工具关键词（仅在启用时检测）
  if (signals.hasToolKeywords) {
    return {
      shouldInject: true,
      reason: 'tool_keywords',
      signals
    };
  }
  
  // 无信号
  return {
    shouldInject: false,
    reason: 'no_signal',
    signals
  };
}

/**
 * 检测并决策是否需要注入
 */
export function detectAndDecide(content: string, conversationId?: string): InjectionDecision {
  const signals = detectIntentSignals(content, conversationId);
  return makeInjectionDecision(signals);
}

