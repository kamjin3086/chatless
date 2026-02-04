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

    // UX: hide line-range metadata in UI preview (user doesn't care).
    // Keep the full structured object for the model; this only affects tool card resultPreview.
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const v: any = value as any;

      // skill__list: show a compact list (no lineCount/triggers noise)
      if (Array.isArray(v.skills) && (typeof v.nextStep === 'string' || typeof v.mode === 'string')) {
        const items = (v.skills as any[])
          .map((s) => {
            const id = String(s?.id || '').trim();
            const name = String(s?.name || id || '').trim();
            const desc = String(s?.description || '').trim();
            const label = id ? `(${id})` : '';
            return `- ${name || '(unknown)'}${label}${desc ? `: ${desc}` : ''}`;
          })
          .filter(Boolean);
        const head = items.slice(0, 20).join('\n');
        const more = items.length > 20 ? `\n... (${items.length - 20} more)` : '';
        const out = [`Skills: ${items.length}`, head, more].filter(Boolean).join('\n');
        return out.slice(0, maxLen);
      }

      // filesystem_read_file (new structured result)
      if (typeof v.content === 'string' && typeof v.totalLines === 'number') {
        return v.content.slice(0, maxLen);
      }

      // filesystem_list_directory (structured, limited)
      if (Array.isArray(v.entries) && typeof v.limit === 'number' && typeof v.returnedCount === 'number') {
        const entries = (v.entries as any[]).filter(Boolean);
        const head = entries.slice(0, 40).map((e) => {
          const name = String(e?.name || '').trim() || '(unknown)';
          const isDir = !!e?.isDirectory;
          return `- ${name}${isDir ? '/' : ''}`;
        });
        const truncated = !!v.truncated;
        const summary = `Entries: ${Number(v.returnedCount)}${truncated ? ` (truncated, limit=${Number(v.limit)})` : ''}`;
        const more = entries.length > 40 ? `\n... (${entries.length - 40} more in preview)` : '';
        return [summary, head.join('\n'), more].filter(Boolean).join('\n').slice(0, maxLen);
      }

      // skill__get (structured result)
      if (typeof v.content === 'string' && (typeof v.id === 'string' || typeof v.name === 'string')) {
        return v.content.slice(0, maxLen);
      }

      // If it is a wrapper { ok, content, ... }
      if (typeof v.content === 'string' && typeof v.ok === 'boolean') {
        return v.content.slice(0, maxLen);
      }

      // Common structured error: { error: { code, message, hints[] } }
      if (v.error && typeof v.error === 'object') {
        const code = String((v.error as any).code || '').trim();
        const msg = String((v.error as any).message || '').trim();
        const hints = Array.isArray((v.error as any).hints) ? ((v.error as any).hints as any[]).map((x) => String(x || '').trim()).filter(Boolean) : [];
        const head = [code ? `Error: ${code}` : 'Error', msg].filter(Boolean).join(' - ');
        const hintText = hints.length ? `\nHints:\n${hints.slice(0, 5).map((h) => `- ${h}`).join('\n')}` : '';
        return `${head}${hintText}`.slice(0, maxLen);
      }

      // Pipeline structured error: { errorDetails: { code, message, hints[] } }
      if (v.errorDetails && typeof v.errorDetails === 'object') {
        const code = String((v.errorDetails as any).code || '').trim();
        const msg = String((v.errorDetails as any).message || '').trim();
        const hints = Array.isArray((v.errorDetails as any).hints)
          ? ((v.errorDetails as any).hints as any[]).map((x) => String(x || '').trim()).filter(Boolean)
          : [];
        const head = [code ? `Error: ${code}` : 'Error', msg].filter(Boolean).join(' - ');
        const hintText = hints.length ? `\nHints:\n${hints.slice(0, 5).map((h) => `- ${h}`).join('\n')}` : '';
        return `${head}${hintText}`.slice(0, maxLen);
      }
    }

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

