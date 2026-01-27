import { DEFAULT_GUIDANCE_RULES } from './guidanceConfig';
import type { GuidanceContext, GuidanceRule, ToolResultKind } from './types';

function toResultString(result: unknown): string {
  if (result === null || result === undefined) return '';
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function ruleMatches(rule: GuidanceRule, ctx: GuidanceContext): boolean {
  const { match } = rule;
  if (match.server && match.server !== ctx.server) return false;
  if (match.tool && match.tool !== ctx.tool) return false;
  if (match.kind && match.kind !== ctx.kind) return false;

  if (match.resultIncludes && match.resultIncludes.length > 0) {
    const hay = toResultString(ctx.result);
    for (const needle of match.resultIncludes) {
      if (!hay.includes(needle)) return false;
    }
  }

  return true;
}

export class GuidanceResolver {
  private static instance: GuidanceResolver | null = null;
  private rules: GuidanceRule[];

  private constructor(rules: GuidanceRule[]) {
    // 高优先级优先匹配
    this.rules = [...rules].sort((a, b) => b.priority - a.priority);
  }

  static getInstance(): GuidanceResolver {
    if (!GuidanceResolver.instance) {
      GuidanceResolver.instance = new GuidanceResolver(DEFAULT_GUIDANCE_RULES);
    }
    return GuidanceResolver.instance;
  }

  /**
   * 根据工具结果上下文生成统一的 follow-up 指引。
   */
  resolve(ctx: GuidanceContext): string {
    for (const rule of this.rules) {
      if (ruleMatches(rule, ctx)) {
        return rule.guidance(ctx);
      }
    }
    // 理论上不会走到这里（generic_success_answer_or_continue兜底）
    return '请基于上述结果继续完成任务。';
  }
}

export function classifyToolResult(result: unknown): ToolResultKind {
  const isErrorObj = typeof result === 'object' && result && (result as any).error;
  const isEmpty =
    !result ||
    (typeof result === 'string' && result.trim().length === 0) ||
    (Array.isArray(result) && result.length === 0);

  if (isErrorObj) {
    const msg = String((result as any).message || '');
    if (msg.includes('Transport send error')) return 'connection_error';
    return 'tool_error';
  }
  if (isEmpty) return 'empty';
  return 'success';
}

