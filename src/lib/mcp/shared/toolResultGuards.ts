import type { Message as LlmMessage } from '@/lib/llm/types';
import type { ToolCallRequest } from '@/lib/llm/types/tool-schema';

export type ToolResultKind = 'success' | 'empty' | 'tool_error';

export function classifyToolResult(result: unknown): ToolResultKind {
  const isEmpty =
    !result ||
    (typeof result === 'string' && result.trim().length === 0) ||
    (Array.isArray(result) && result.length === 0);
  if (isEmpty) return 'empty';

  if (result && typeof result === 'object') {
    const r: any = result;
    if (r.skipped) return 'tool_error';
    if (r.error) return 'tool_error';

    if (typeof r.ok === 'boolean' && r.ok === false) {
      const hasActionableDetail =
        typeof r.failedCount === 'number' ||
        typeof r.deletedCount === 'number' ||
        typeof r.matchedCount === 'number' ||
        Array.isArray(r.failed) ||
        Array.isArray(r.deleted) ||
        Array.isArray(r.matches);
      if (!hasActionableDetail) return 'tool_error';
    }
    if (typeof r.success === 'boolean' && r.success === false) return 'tool_error';

    if (r.title && typeof r.title === 'string') {
      const title = r.title.toLowerCase();
      if (
        title.includes('just a moment') ||
        title.includes('checking your browser') ||
        title.includes('cloudflare') ||
        title.includes('access denied') ||
        title.includes('403 forbidden') ||
        title.includes('please wait')
      ) {
        return 'tool_error';
      }
    }

    if (r.title && r.content === '' && Array.isArray(r.links) && r.links.length === 0) {
      return 'empty';
    }
  }
  return 'success';
}

export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return '[function]';
  if (typeof value !== 'object') return '[unknown]';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${k}:${stableStringify(obj[k])}`);
  return `{${parts.join(',')}}`;
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function summarizeToolOutput(output: unknown): unknown {
  try {
    if (typeof output === 'string') {
      const s = output;
      if (s.length > 4000) return `${s.slice(0, 4000)}\n... (truncated, ${s.length} chars)`;
      return s;
    }
    if (Array.isArray(output)) {
      const arr = output as unknown[];
      if (arr.length <= 60) return output;
      return { summary: `Array(${arr.length}) truncated`, head: arr.slice(0, 30), tail: arr.slice(-10) };
    }
    if (output && typeof output === 'object') {
      const s = safeJson(output);
      if (s.length > 8000) return { summary: `Object truncated (${s.length} chars)`, preview: s.slice(0, 8000) };
      return output;
    }
  } catch {
    // ignore
  }
  return output;
}

export type BufferedToolResult = {
  cardIdOrKey: string;
  callId: string;
  server: string;
  tool: string;
  args?: Record<string, unknown>;
  result: unknown;
};

export function buildToolRoleAppendix(
  batch: BufferedToolResult[],
  options?: { stripInternal?: (v: unknown) => unknown },
): { assistantMsg: LlmMessage; toolMsgs: LlmMessage[] } {
  const strip = options?.stripInternal ?? ((v: unknown) => v);
  const tool_calls: ToolCallRequest[] = batch.map((r) => ({
    id: r.callId,
    type: 'function',
    function: {
      name: `${r.server}__${r.tool}`,
      arguments: safeJson(r.args || {}),
    },
  }));
  const assistantMsg: LlmMessage = { role: 'assistant', content: '', tool_calls };
  const toolMsgs: LlmMessage[] = batch.map((r) => ({
    role: 'tool',
    tool_call_id: r.callId,
    content: typeof r.result === 'string' ? r.result : safeJson(summarizeToolOutput(strip(r.result))),
  })) as LlmMessage[];
  return { assistantMsg, toolMsgs };
}

export function isPipelineSkipped(result: unknown): boolean {
  return !!(result && typeof result === 'object' && (result as any).skipped === true);
}
