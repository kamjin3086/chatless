import type { Message as LlmMessage } from '@/lib/llm/types';
import { chat } from '@/lib/llm';

/**
 * 极简 token 估算：用于触发 compaction 的阈值判断。
 * - 不追求精准，只追求“不会爆窗”。
 */
export function estimateTokens(messages: LlmMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    // Include protocol fields and provider opaque data.  Counting only visible
    // text makes a tool-heavy turn look cheap and is the main source of silent
    // context overflows in the old runner.
    chars += JSON.stringify({
      role: m.role,
      content: m.content,
      tool_call_id: m.tool_call_id,
      tool_calls: m.tool_calls,
      name: m.name,
      providerData: m.providerData,
      raw: m.raw,
    }).length;
  }
  // Conservative estimate for mixed English/Chinese and JSON syntax.
  return Math.ceil(chars / 2.5);
}

/** Conservative context limits when an endpoint does not expose metadata. */
export function resolveContextWindowTokens(_provider: string, model: string): number {
  const normalized = String(model || '').toLowerCase();
  if (/qwen3\.8[-_]?flash[-_]?next/.test(normalized)) return 262_144;
  return 8_192;
}

export type CompactOptions = {
  provider: string;
  model: string;
  /** 触发压缩阈值（估算 token） */
  maxInputTokens?: number;
  /** Reported model context window. Used when maxInputTokens is omitted. */
  contextWindowTokens?: number;
  /** Output reservation and safety margin are counted outside the input budget. */
  reserveOutputTokens?: number;
  safetyMarginRatio?: number;
  /** 保留最近 N 条 messages */
  keepLastN?: number;
  /** 是否允许调用一次 LLM 生成摘要 */
  allowSummarize?: boolean;
};

/**
 * ContextWindowManager：ChatCompletions 下的最小 compaction。
 *
 * 策略：
 * - 若未超阈值：原样返回
 * - 若超阈值：保留尾部 keepLastN；头部压缩成 1 条 summary（可选用 LLM）
 */
export class ContextWindowManager {
  async compact(messages: LlmMessage[], opts: CompactOptions): Promise<LlmMessage[]> {
    const list = Array.isArray(messages) ? messages : [];
    const contextWindow = Math.max(1, opts.contextWindowTokens ?? opts.maxInputTokens ?? 8192);
    const reserve = Math.max(0, opts.reserveOutputTokens ?? Math.min(4096, Math.floor(contextWindow * 0.2)));
    const safety = Math.max(0, Math.min(0.5, opts.safetyMarginRatio ?? 0.08));
    const budget = Math.max(1, opts.maxInputTokens ?? Math.floor((contextWindow - reserve) * (1 - safety)));
    if (estimateTokens(list) <= budget) return list;

    const keepN = Math.max(4, Math.floor(opts.keepLastN ?? 24));
    let split = Math.max(0, list.length - keepN);
    // Never split an assistant tool request from the tool results that answer
    // it.  If the tentative tail starts in the middle of such a turn, move the
    // split point back to the assistant message.
    while (split > 0 && list[split]?.role === 'tool') split -= 1;
    if (split > 0 && list[split - 1]?.role === 'assistant' && list[split - 1]?.tool_calls?.length) {
      split -= 1;
    }
    const tail = list.slice(split);
    const head = list.slice(0, split);

    const summary =
      opts.allowSummarize && head.length > 0
        ? await this.summarize(head, opts.provider, opts.model)
        : this.fallbackSummary(head);

    const out: LlmMessage[] = [];
    out.push({ role: 'system', content: summary });
    out.push(...tail);
    return out;
  }

  private fallbackSummary(head: LlmMessage[]): string {
    const userCount = head.filter((m) => m.role === 'user').length;
    const assistantCount = head.filter((m) => m.role === 'assistant').length;
    return [
      '【对话历史摘要】',
      `已压缩早期历史以避免上下文溢出。`,
      `统计：user=${userCount}, assistant=${assistantCount}, total=${head.length}`,
      '如需引用早期细节，请要求重新读取/重新运行相关工具。',
    ].join('\n');
  }

  private async summarize(head: LlmMessage[], provider: string, model: string): Promise<string> {
    const prompt: LlmMessage[] = [
      {
        role: 'system',
        content:
          '你是一个对话压缩器。请将以下对话与工具结果压缩成简洁要点，保留：目标、已完成、关键发现、未解决问题、后续建议。不要编造未出现的信息。',
      },
      ...head,
      { role: 'user', content: '请输出一段不超过 2500 字的摘要。' },
    ];
    try {
      const res = await chat(provider, model, prompt as any, { temperature: 0.2 });
      const txt = String(res?.content || '').trim();
      return txt ? `【对话历史摘要】\n${txt}` : this.fallbackSummary(head);
    } catch {
      return this.fallbackSummary(head);
    }
  }
}

