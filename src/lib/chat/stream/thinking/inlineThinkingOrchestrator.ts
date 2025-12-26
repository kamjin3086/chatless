import type { InlineThinkingEvent, InlineThinkingParser } from './types';
import { createThinkTagParser } from './thinkTagParser';
import { createReasoningTagParser } from './reasoningTagParser';
import { createGptOssChannelParser } from './gptOssChannelParser';

/**
 * Inline thinking 解析编排器
 *
 * 设计：
 * - 逐层尝试解析（think tag / reasoning tag / gpt-oss channel）
 * - 为避免“多个解析器各自维护代码围栏状态”导致冲突，本编排器采用“串行管线”：
 *   - 把上一层输出的 text 再喂给下一层
 *   - thinking 事件直接透传
 *
 * 约束：
 * - 若同一段文本同时包含多种机制，优先级为：think_tag > reasoning_tag > gpt_oss_channel
 */
export function createInlineThinkingOrchestrator(): InlineThinkingParser {
  const parsers: InlineThinkingParser[] = [
    createThinkTagParser(),
    createReasoningTagParser(),
    createGptOssChannelParser(),
  ];

  const runPipeline = (events: InlineThinkingEvent[], stageIdx: number): InlineThinkingEvent[] => {
    if (stageIdx >= parsers.length) return events;
    const p = parsers[stageIdx];
    const out: InlineThinkingEvent[] = [];
    for (const ev of events) {
      if (ev.type !== 'text') {
        out.push(ev);
        continue;
      }
      const next = p.push(ev.text);
      if (next.length > 0) out.push(...next);
    }
    return runPipeline(out, stageIdx + 1);
  };

  return {
    push(chunk: string) {
      // 起始输入都当作 text
      return runPipeline([{ type: 'text', text: String(chunk || '') }], 0);
    },
    flush() {
      // 逐个 flush，并把 text 再走管线后续阶段
      let events: InlineThinkingEvent[] = [];
      for (let i = 0; i < parsers.length; i++) {
        const flushed = parsers[i].flush();
        // flush 出来的事件中只有 text 需要继续往后走
        events = runPipeline(flushed, i + 1);
      }
      return events;
    },
  };
}




