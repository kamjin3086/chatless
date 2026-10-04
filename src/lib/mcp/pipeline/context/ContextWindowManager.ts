import type { Message as LlmMessage } from '@/lib/llm/types';
import { chat } from '@/lib/llm';
import { sha256Hex } from '@/lib/utils/sha256';
import { resolveOutputReserve } from '@/lib/llm/outputBudget';

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
  /** 本轮实际用上了历史摘要（复用或新生成）时回调，供界面显示"已压缩"。 */
  onCompacted?: (info: { summary: string; coveredMessages: number; reused: boolean }) => void;
  /** Cancels the compaction request together with its owning run. */
  signal?: AbortSignal;
  onCheckpoint?: (checkpoint: { summary: string; coveredMessages: number; historyFingerprint: string }) => Promise<void>;
};

export type ContextCheckpoint = {
  summary: string;
  coveredMessages: number;
  historyFingerprint: string;
};

const summaryInstruction: LlmMessage = {
  role: 'system',
  content: 'Compress the following older conversation into a concise record: the user goals and constraints, key findings with their sources, actions already taken and their side effects, what is still open, and how far the reading got. Never invent anything.',
};

export class ContextWindowManager {
  async compact(messages: LlmMessage[], opts: CompactOptions): Promise<LlmMessage[]> {
    // 窗口未知时不做任何猜测：既不能判断"装不下"，也不该把历史摘要掉。
    // 之前这里默认 8192，于是 262K 窗口的模型被当成 8K：正常一轮被判超预算直接
    // 失败，刚聊几句又被提前压缩。压缩必须有真实窗口作为依据才做。
    const window = Number(opts.contextWindowTokens);
    if (!Number.isFinite(window) || window <= 0) {
      return messages;
    }

    const reserve = opts.reserveOutputTokens
      ?? resolveOutputReserve({ contextWindow: window });
    const safety = opts.safetyMarginRatio ?? 0.08;
    const capacity = Math.floor(window * (1 - safety)) - reserve;
    const fixed = estimateTokens(opts.prefixMessages || []) + Math.ceil(JSON.stringify(opts.tools || []).length / 2.5);
    const budget = Math.min(opts.maxInputTokens ?? capacity, capacity) - fixed;

    if (!Number.isFinite(budget) || budget <= 0) {
      throw new Error('上下文预算不足：提示词、工具定义与输出预留已占满窗口');
    }
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
      const reused: LlmMessage[] = [{ role: 'system', content: `[Conversation summary]\n${opts.checkpoint.summary}` }, ...tail];
      if (estimateTokens(reused) <= budget) {
        opts.onCompacted?.({ summary: opts.checkpoint.summary, coveredMessages: split, reused: true });
        return reused;
      }
    }

    // 跨轮续写：上一轮的摘要覆盖了 [0, covered)，只要这段前缀没变就能接着用，
    // 只需把新增的 (covered, split) 追加进摘要。历史只能追加，所以前缀指纹一致
    // 就说明旧摘要仍然准确。
    let seedSummary = '';
    let coveredStart = 0;
    const previous = opts.checkpoint;
    if (previous?.summary && previous.coveredMessages > 0 && previous.coveredMessages < split) {
      const prefixFingerprint = await sha256Hex(JSON.stringify(messages.slice(0, previous.coveredMessages)));
      if (prefixFingerprint === previous.historyFingerprint) {
        seedSummary = previous.summary;
        coveredStart = previous.coveredMessages;
      }
    }
    // Compact in bounded segments instead of one oversized request: a long
    // completed history must not fail just because the prefix is big. Segments
    // are formed with the same budget arithmetic as the real request, so the
    // whole prefix still fits in a single summary when it genuinely fits.
    const summaryTokens = Math.max(512, Math.min(reserve, Math.floor(capacity * 0.25)));
    const prefix = messages.slice(0, split);

    let summary = seedSummary;
    const summarize = async (part: LlmMessage[]): Promise<void> => {
      const prompt: LlmMessage[] = [summaryInstruction];
      if (summary) prompt.push({ role: 'system', content: `[Existing summary]\n${summary}` });
      prompt.push(...part, { role: 'user' as const, content: 'Write the summary.' });
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
    for (const message of prefix.slice(coveredStart)) {
      if (segment.length) {
        const probe: LlmMessage[] = [summaryInstruction];
        if (summary) probe.push({ role: 'system', content: `[Existing summary]\n${summary}` });
        probe.push(...segment, message, { role: 'user' as const, content: 'Write the summary.' });
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
    opts.onCompacted?.({ summary, coveredMessages: split, reused: false });
    const result: LlmMessage[] = [{ role: 'system', content: `[Conversation summary]\n${summary}` }, ...tail];
    if (estimateTokens(result) > budget) throw new Error('压缩后仍超出上下文预算；原始历史已保留');
    return result;
  }
}
