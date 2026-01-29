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
import { getSkillManager, type SkillIndexEntry } from '@/lib/skills';

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

// ================================
// Skills 意图检测相关函数
// ================================

/**
 * 技能触发结果
 */
export interface SkillTriggerResult {
  /** 触发的技能 ID 列表 */
  triggeredSkillIds: string[];
  /** 是否有触发 */
  hasTriggered: boolean;
  /** 触发的技能详情 */
  triggeredSkills: SkillIndexEntry[];
}

/**
 * 检测用户输入是否触发特定技能
 * 
 * 通过检查用户输入中是否包含技能的触发关键词来判断
 * 
 * @param userContent - 用户输入内容
 * @returns 触发结果
 */
export function detectSkillTriggers(userContent: string): SkillTriggerResult {
  try {
    const manager = getSkillManager();
    const skillIndex = manager.getSkillIndex();
    
    if (skillIndex.length === 0) {
      return {
        triggeredSkillIds: [],
        hasTriggered: false,
        triggeredSkills: [],
      };
    }
    
    const contentLower = String(userContent || '').toLowerCase();
    const triggeredSkills: SkillIndexEntry[] = [];
    
    for (const skill of skillIndex) {
      const skillIdLower = String((skill as any)?.id || '').toLowerCase();
      const skillNameLower = String((skill as any)?.name || '').toLowerCase();

      // 检查 skill id（优先：用户常直接指定 id）
      if (skillIdLower && contentLower.includes(skillIdLower)) {
        triggeredSkills.push(skill);
        continue;
      }

      // 检查技能名称
      if (skillNameLower && contentLower.includes(skillNameLower)) {
        triggeredSkills.push(skill);
        continue;
      }
      
      // 检查触发关键词
      if (skill.triggers && skill.triggers.length > 0) {
        const isTriggered = skill.triggers.some(trigger => 
          contentLower.includes(String(trigger || '').toLowerCase())
        );
        if (isTriggered) {
          triggeredSkills.push(skill);
        }
      }
    }
    
    return {
      triggeredSkillIds: triggeredSkills.map(s => s.id),
      hasTriggered: triggeredSkills.length > 0,
      triggeredSkills,
    };
  } catch (error) {
    console.warn('[IntentDetector] 技能触发检测失败:', error);
    return {
      triggeredSkillIds: [],
      hasTriggered: false,
      triggeredSkills: [],
    };
  }
}

/**
 * 检测是否使用 @skill 语法显式调用技能
 * 
 * 支持格式：
 * - @skill:skill-id
 * - @skill skill-id
 * 
 * @param content - 用户输入内容
 * @returns 匹配的技能 ID 列表
 */
export function detectExplicitSkillMention(content: string): string[] {
  const skillMentionPatterns = [
    /@skill[:\s]([a-zA-Z0-9_-]+)/gi,  // @skill:id 或 @skill id
    /\[\[skill:([a-zA-Z0-9_-]+)\]\]/gi,  // [[skill:id]]
  ];
  
  const mentionedSkills: string[] = [];
  
  for (const pattern of skillMentionPatterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const skillId = match[1];
      if (skillId && !mentionedSkills.includes(skillId)) {
        mentionedSkills.push(skillId);
      }
    }
  }
  
  return mentionedSkills;
}

/**
 * 综合检测技能意图
 * 
 * 优先级：
 * 1. 显式 @skill:id 调用
 * 2. 关键词触发
 * 
 * @param content - 用户输入内容
 */
export function detectSkillIntent(content: string): {
  explicitMentions: string[];
  triggerMatches: SkillTriggerResult;
  shouldPreloadSkill: boolean;
  skillIdsToPreload: string[];
} {
  const explicitMentions = detectExplicitSkillMention(content);
  const triggerMatches = detectSkillTriggers(content);
  
  // 合并需要预加载的技能
  const skillIdsToPreload = [
    ...new Set([...explicitMentions, ...triggerMatches.triggeredSkillIds])
  ];
  
  return {
    explicitMentions,
    triggerMatches,
    shouldPreloadSkill: skillIdsToPreload.length > 0,
    skillIdsToPreload,
  };
}

