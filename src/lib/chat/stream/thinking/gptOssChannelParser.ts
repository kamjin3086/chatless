import type { InlineThinkingEvent, InlineThinkingParser } from './types';

/**
 * GPT‑OSS / 类似“channel”风格思考解析器（保底版）
 *
 * 常见形态：
 * - <|channel|>analysis ... <|channel|>final ... （analysis 视为 thinking）
 *
 * 注意：
 * - 本解析器只处理 analysis/final，不处理 commentar y to=（那是工具调用，由工具抑制阀处理）
 * - 同样忽略代码围栏/行内代码中的内容
 */
export function createGptOssChannelParser(): InlineThinkingParser {
  let buffer = '';
  let inThink = false;
  let inFence = false;
  let inInline = false;

  const ANALYSIS = /<\|channel\|>\s*analysis\b/i;
  const FINAL = /<\|channel\|>\s*final\b/i;

  const updateCodeState = (s: string, i: number) => {
    if (!inInline && s.startsWith('```', i)) {
      inFence = !inFence;
      return 3;
    }
    if (!inFence && s[i] === '`') {
      inInline = !inInline;
      return 1;
    }
    return 0;
  };

  const scan = (): InlineThinkingEvent[] => {
    const out: InlineThinkingEvent[] = [];
    const SAFE_TAIL = 64;
    let s = buffer;
    if (s.length > SAFE_TAIL) {
      buffer = s.slice(-SAFE_TAIL);
      s = s.slice(0, -SAFE_TAIL);
    } else {
      return out;
    }

    let i = 0;
    let last = 0;

    const flushText = (end: number) => {
      const piece = s.slice(last, end);
      if (!piece) return;
      out.push(inThink ? { type: 'think_token', text: piece } : { type: 'text', text: piece });
    };

    while (i < s.length) {
      const step = updateCodeState(s, i);
      if (step > 0) {
        flushText(i);
        const mark = s.slice(i, i + step);
        out.push(inThink ? { type: 'think_token', text: mark } : { type: 'text', text: mark });
        i += step;
        last = i;
        continue;
      }

      if (!inFence && !inInline) {
        const sub = s.slice(i);
        const mA = ANALYSIS.exec(sub);
        if (!inThink && mA && mA.index === 0) {
          flushText(i);
          out.push({ type: 'think_start', mode: 'gpt_oss_channel' });
          inThink = true;
          i += mA[0].length;
          last = i;
          continue;
        }
        const mF = FINAL.exec(sub);
        if (inThink && mF && mF.index === 0) {
          flushText(i);
          out.push({ type: 'think_end', mode: 'gpt_oss_channel' });
          inThink = false;
          i += mF[0].length;
          last = i;
          continue;
        }
      }

      i += 1;
    }

    flushText(s.length);
    return out;
  };

  return {
    push(chunk: string) {
      buffer += String(chunk || '');
      return scan();
    },
    flush() {
      const out: InlineThinkingEvent[] = [];
      const rest = buffer;
      buffer = '';
      if (!rest) return out;
      if (inThink) {
        out.push({ type: 'think_token', text: rest });
        out.push({ type: 'think_end', mode: 'gpt_oss_channel' });
        inThink = false;
      } else {
        out.push({ type: 'text', text: rest });
      }
      return out;
    },
  };
}




