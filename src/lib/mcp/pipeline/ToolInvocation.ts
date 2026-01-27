import type { Message as LlmMessage } from '@/lib/llm/types';

export type ToolInvocationParams = {
  assistantMessageId: string;
  conversationId: string;
  server: string;
  tool: string;
  args?: Record<string, unknown>;
  provider: string;
  model: string;
  historyForLlm: LlmMessage[];
  originalUserContent: string;
  callId?: string;
  cardId?: string;
  lockKey?: string;
};

function stableStringify(value: unknown): string {
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

export function buildResultPreview(value: unknown, maxLen = 12000): string {
  try {
    if (typeof value === 'string') return value.slice(0, maxLen);
    const json = JSON.stringify(value);
    return (json ?? String(value)).slice(0, maxLen);
  } catch {
    return String(value).slice(0, maxLen);
  }
}

export class ToolInvocation {
  readonly assistantMessageId: string;
  readonly conversationId: string;
  readonly server: string;
  readonly tool: string;
  readonly args?: Record<string, unknown>;
  readonly provider: string;
  readonly model: string;
  readonly historyForLlm: LlmMessage[];
  readonly originalUserContent: string;
  readonly callId?: string;
  readonly lockKey?: string;

  cardId?: string;

  constructor(params: ToolInvocationParams) {
    this.assistantMessageId = params.assistantMessageId;
    this.conversationId = params.conversationId;
    this.server = params.server;
    this.tool = params.tool;
    this.args = params.args;
    this.provider = params.provider;
    this.model = params.model;
    this.historyForLlm = params.historyForLlm;
    this.originalUserContent = params.originalUserContent;
    this.callId = params.callId;
    this.cardId = params.cardId;
    this.lockKey = params.lockKey;
  }

  ensureCardId(): string {
    if (!this.cardId) this.cardId = crypto.randomUUID();
    return this.cardId;
  }

  /**
   * 幂等键（尽量稳定）：优先使用 provider/tool_call_id，其次使用 server+tool+args。
   * 注意：它用于“同一条 assistant 消息内”的重复调用防抖，因此必须包含 assistantMessageId。
   */
  buildCallKey(): string {
    const base = `${this.assistantMessageId}:${this.server}.${this.tool}`;
    if (this.callId && this.callId.trim()) return `${base}:callId=${this.callId.trim()}`;
    return `${base}:${stableStringify(this.args || {})}`;
  }
}

