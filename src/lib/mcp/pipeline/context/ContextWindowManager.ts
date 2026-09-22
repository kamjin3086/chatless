import type { Message as LlmMessage } from '@/lib/llm/types';
import { chat } from '@/lib/llm';
import { sha256Hex } from '@/lib/utils/sha256';
import { resolveOutputBudget } from '@/lib/llm/outputBudget';

/** An estimate, not a tokenizer. Includes protocol data and image payloads. */
export function estimateTokens(messages: LlmMessage[]): number {
  return Math.ceil(JSON.stringify(messages).length / 2.5);
}

export type CompactOptions = {
  provider: string;
  model: string;
  maxInputTokens?: number;
  contextWindowTokens?: number;
  reserveOutputTokens?: number;
  safetyMarginRatio?: number;
  keepLastN?: number;
  allowSummarize?: boolean;
  prefixMessages?: LlmMessage[];
  tools?: unknown;
  checkpoint?: { summary: string; coveredMessages: number; historyFingerprint: string };
  /** Cancels the compaction request together with its owning run. */
  signal?: AbortSignal;
  onCheckpoint?: (checkpoint: { summary: string; coveredMessages: number; historyFingerprint: string }) => Promise<void>;
};

const summaryInstruction: LlmMessage = {
  role: 'system',
  content: '压缩以下旧对话为简洁记录，保留用户目标与约束、关键发现及来源、已执行操作与副作用、未完成事项和阅读进度。不要编造。',
};

export class ContextWindowManager {
  async compact(messages: LlmMessage[], opts: CompactOptions): Promise<LlmMessage[]> {
    const window = opts.contextWindowTokens ?? 8192;
    // The same function the request body uses, so the reservation always matches
    // what the model was actually allowed to produce.
    const reserve = opts.reserveOutputTokens
      ?? resolveOutputBudget({ contextWindow: opts.contextWindowTokens })
      ?? Math.min(4096, Math.floor(window * 0.2));
    const safety = opts.safetyMarginRatio ?? 0.08;
    const capacity = Math.floor(window * (1 - safety)) - reserve;
    const fixed = estimateTokens(opts.prefixMessages || []) + Math.ceil(JSON.stringify(opts.tools || []).length / 2.5);
    const budget = Math.min(opts.maxInputTokens ?? capacity, capacity) - fixed;
    if (!Number.isFinite(budget) || budget <= 0) throw new Error('上下文预算不足：提示词、工具定义与输出预留已占满窗口');
    const used = estimateTokens(messages);
    if (used <= budget * 0.8) return messages;

    // Keep complete recent user turns. Never cut a tool request/result group.
    let split = Math.max(0, messages.length - Math.max(1, opts.keepLastN ?? 8));
    while (split > 0 && messages[split].role !== 'user') split -= 1;
    if (!opts.allowSummarize || split === 0) {
      if (used <= budget) return messages;
      throw new Error('当前完整轮次超出上下文预算；原始历史已保留，请缩小输入或调整模型窗口');
    }
    const tail = messages.slice(split);
    const historyFingerprint = await sha256Hex(JSON.stringify(messages.slice(0, split)));
    if (opts.checkpoint?.coveredMessages === split && opts.checkpoint.historyFingerprint === historyFingerprint) {
      const reused: LlmMessage[] = [{ role: 'system', content: `【对话历史摘要】\n${opts.checkpoint.summary}` }, ...tail];
      if (estimateTokens(reused) <= budget) return reused;
    }
    // Compact in bounded segments instead of one oversized request: a long
    // completed history must not fail just because the prefix is big. Segments
    // are formed with the same budget arithmetic as the real request, so the
    // whole prefix still fits in a single summary when it genuinely fits.
    const summaryTokens = Math.max(512, Math.min(reserve, Math.floor(capacity * 0.25)));
    const prefix = messages.slice(0, split);

    let summary = '';
    const summarize = async (part: LlmMessage[]): Promise<void> => {
      const prompt: LlmMessage[] = [summaryInstruction];
      if (summary) prompt.push({ role: 'system', content: `【已有摘要】\n${summary}` });
      prompt.push(...part, { role: 'user' as const, content: '请输出摘要。' });
      if (estimateTokens(prompt) > capacity) {
        throw new Error('待压缩历史超出摘要请求预算；原始历史已保留');
      }
      // No statistics-only fallback: a failed summary must not erase constraints.
      const response = await chat(opts.provider, opts.model, prompt, {
        temperature: 0.2, maxTokens: summaryTokens, __signal: opts.signal, __priority: 'low',
      });
      const next = String(response?.content || '').trim();
      if (!next) throw new Error('历史压缩返回空摘要；原始历史已保留');
      summary = next;
    };

    let segment: LlmMessage[] = [];
    for (const message of prefix) {
      if (segment.length) {
        const probe: LlmMessage[] = [summaryInstruction];
        if (summary) probe.push({ role: 'system', content: `【已有摘要】\n${summary}` });
        probe.push(...segment, message, { role: 'user' as const, content: '请输出摘要。' });
        if (estimateTokens(probe) > capacity) {
          await summarize(segment);
          segment = [];
        }
      }
      segment.push(message);
    }
    await summarize(segment);
    if (!summary) throw new Error('历史压缩返回空摘要；原始历史已保留');
    await opts.onCheckpoint?.({ summary, coveredMessages: split, historyFingerprint });
    const result: LlmMessage[] = [{ role: 'system', content: `【对话历史摘要】\n${summary}` }, ...tail];
    if (estimateTokens(result) > budget) throw new Error('压缩后仍超出上下文预算；原始历史已保留');
    return result;
  }
}
