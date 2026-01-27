import type { Message as LlmMessage } from '@/lib/llm/types';
import { chat } from '@/lib/llm';

/**
 * 极简 token 估算：用于触发 compaction 的阈值判断。
 * - 不追求精准，只追求“不会爆窗”。
 */
export function estimateTokens(messages: LlmMessage[]): number {
  let chars = 0;
  for (const m of messages) chars += String(m.content || '').length;
  // 经验值：英文约 4 chars/token；中文更密，取 2.5 更保守
  return Math.ceil(chars / 2.5);
}

export type CompactOptions = {
  provider: string;
  model: string;
  /** 触发压缩阈值（估算 token） */
  maxInputTokens: number;
  /** 保留最近 N 条 messages */
  keepLastN: number;
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
    if (estimateTokens(list) <= opts.maxInputTokens) return list;

    const keepN = Math.max(4, Math.floor(opts.keepLastN));
    const tail = list.slice(Math.max(0, list.length - keepN));
    const head = list.slice(0, Math.max(0, list.length - keepN));

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

