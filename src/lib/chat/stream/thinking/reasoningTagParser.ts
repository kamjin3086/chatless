import type { InlineThinkingEvent, InlineThinkingParser } from './types';

/**
 * <reasoning>...</reasoning> 流式解析器（DeepSeek 等常见）
 * - 只在非代码围栏/非行内代码中生效
 */
export function createReasoningTagParser(): InlineThinkingParser {
  let buffer = '';
  let inThink = false;
  let inFence = false;
  let inInline = false;

  const OPEN = '<reasoning>';
  const CLOSE = '</reasoning>';

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

    if (!inThink && !buffer.includes('<') && !buffer.includes('`')) {
      const txt = buffer;
      buffer = '';
      return txt ? [{ type: 'text', text: txt }] : out;
    }

    // 看到完整 </reasoning> 时必须立即结束
    const lastClose = buffer.lastIndexOf(CLOSE);
    if (lastClose >= 0) {
      const upto = lastClose + CLOSE.length;
      const s = buffer.slice(0, upto);
      buffer = buffer.slice(upto);
      return scanChunk(s);
    }

    // ——【修复】短 buffer 快速路径 ——
    // 如果 buffer 不可能是本解析器标签的前缀，立即作为 text 输出
    // 避免 "</think>" 等其他标签被误保留而导致事件丢失
    const SAFE_TAIL = 48;
    if (buffer.length <= SAFE_TAIL) {
      // 检查 buffer 是否可能是 <reasoning> 或 </reasoning> 的前缀
      const couldBeOpenPrefix = OPEN.startsWith(buffer) || buffer.startsWith(OPEN.slice(0, buffer.length));
      const couldBeClosePrefix = CLOSE.startsWith(buffer) || buffer.startsWith(CLOSE.slice(0, buffer.length));
      // 检查 buffer 是否包含可能跨 chunk 的 '<' 起点
      const hasPartialTag = buffer.includes('<') && (
        '<reasoning>'.startsWith(buffer.slice(buffer.lastIndexOf('<'))) ||
        '</reasoning>'.startsWith(buffer.slice(buffer.lastIndexOf('<')))
      );
      
      if (!couldBeOpenPrefix && !couldBeClosePrefix && !hasPartialTag) {
        // 不可能匹配本解析器的标签，直接输出
        const txt = buffer;
        buffer = '';
        return txt ? [{ type: 'text', text: txt }] : out;
      }
      return out;
    }
    const cutBase = buffer.length - SAFE_TAIL;
    const lastLt = buffer.lastIndexOf('<');
    const cut = (lastLt >= cutBase) ? lastLt : cutBase;
    const s = buffer.slice(0, cut);
    buffer = buffer.slice(cut);
    return scanChunk(s);
  };

  const scanChunk = (s: string): InlineThinkingEvent[] => {
    const out: InlineThinkingEvent[] = [];

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
        if (!inThink && s.startsWith(OPEN, i)) {
          flushText(i);
          out.push({ type: 'think_start', mode: 'reasoning_tag' });
          inThink = true;
          i += OPEN.length;
          last = i;
          continue;
        }
        if (inThink && s.startsWith(CLOSE, i)) {
          flushText(i);
          out.push({ type: 'think_end', mode: 'reasoning_tag' });
          inThink = false;
          i += CLOSE.length;
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
        out.push({ type: 'think_end', mode: 'reasoning_tag' });
        inThink = false;
      } else {
        out.push({ type: 'text', text: rest });
      }
      return out;
    },
  };
}


