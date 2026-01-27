import type { ToolDefinition } from '@/lib/llm/types/tool-schema';
import type { Message as LlmMessage } from '@/lib/llm/types';

export type PromptEnvelope = {
  /** 稳定前缀：尽量不变，利于行为稳定与缓存 */
  prefixMessages: LlmMessage[];
  /** 工具定义（已排序） */
  tools: ToolDefinition[];
};

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || value === true || value === false || typeof value === 'bigint') return String(value);
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return '[function]';
  if (typeof value !== 'object') return '[unknown]';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${k}:${stableStringify(obj[k])}`);
  return `{${parts.join(',')}}`;
}

function sortToolsDeterministically(tools: ToolDefinition[]): ToolDefinition[] {
  const list = Array.isArray(tools) ? [...tools] : [];
  list.sort((a, b) => {
    const an = String(a?.name || '');
    const bn = String(b?.name || '');
    const rank = (n: string): number => {
      const name = String(n || '').toLowerCase();
      // 明确偏好：文件系统统一 filesystem，shell_executor 次之
      if (name.startsWith('filesystem__')) return 0;
      if (name.startsWith('shell_executor__')) return 1;
      return 5;
    };
    const ar = rank(an);
    const br = rank(bn);
    if (ar !== br) return ar - br;
    if (an !== bn) return an.localeCompare(bn);
    // name 相同则按参数 schema 稳定序列化
    return stableStringify(a?.parameters).localeCompare(stableStringify(b?.parameters));
  });
  return list;
}

/**
 * PromptEnvelopeBuilder：将“稳定前缀”与“可变事件日志”分离。
 *
 * - prefixMessages：permissions / environment / project instructions
 * - tools：确定性排序，避免顺序漂移导致行为不稳定
 *
 * 注意：当前项目 Message.role 只支持 system/user/assistant，
 * 这里用 system 作为最小实现，后续可升级 developer role。
 */
export class PromptEnvelopeBuilder {
  build(params: {
    permissionsInstructions?: string;
    environmentContext?: string;
    projectInstructions?: string;
    tools?: ToolDefinition[];
  }): PromptEnvelope {
    const prefixMessages: LlmMessage[] = [];

    if (params.permissionsInstructions) {
      prefixMessages.push({ role: 'system', content: String(params.permissionsInstructions) });
    }
    if (params.projectInstructions) {
      prefixMessages.push({ role: 'system', content: String(params.projectInstructions) });
    }
    if (params.environmentContext) {
      prefixMessages.push({ role: 'system', content: String(params.environmentContext) });
    }

    const tools = sortToolsDeterministically(params.tools || []);
    return { prefixMessages, tools };
  }
}

