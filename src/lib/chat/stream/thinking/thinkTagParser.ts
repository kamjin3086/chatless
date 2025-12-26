import type { InlineThinkingEvent, InlineThinkingParser } from './types';

/**
 * <think>...</think> 流式解析器（保底版）
 * - 只在非代码围栏/非行内代码中生效
 * - 支持跨 chunk 的标签切分（例如 "<th" + "ink>"）
 */
export function createThinkTagParser(): InlineThinkingParser {
  let buffer = '';
  let inThink = false;
  let inFence = false;
  let inInline = false;

  const OPEN = '<think>';
  const CLOSE = '</think>';

  const eventsFromPlain = (txt: string): InlineThinkingEvent[] =>
    txt ? [{ type: 'text', text: txt }] : [];

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

    // 快速路径：明显不含任何标签/代码标记时直接透传，避免不必要的“尾巴等待”
    if (!inThink && !buffer.includes('<') && !buffer.includes('`')) {
      const txt = buffer;
      buffer = '';
      return txt ? [{ type: 'text', text: txt }] : out;
    }

    // 关键修复：一旦缓冲中出现完整的 </think>，必须在本次 scan 中处理到结束位置，
    // 否则会因为“保留尾巴”导致 THINK_END 延迟触发（用户体验：思考不结束）。
    const lastClose = buffer.lastIndexOf(CLOSE);
    if (lastClose >= 0) {
      const upto = lastClose + CLOSE.length;
      const s = buffer.slice(0, upto);
      buffer = buffer.slice(upto);
      return scanChunk(s);
    }

    // 未出现完整 CLOSE：保留尾巴用于跨 chunk 匹配（但不能截断可能的 "<...>" 起点）
    const SAFE_TAIL = 24;
    if (buffer.length <= SAFE_TAIL) return out;
    const cutBase = buffer.length - SAFE_TAIL;
    // 若最后一个 '<' 落在尾巴范围内，从 '<' 开始保留，避免输出半截标签
    const lastLt = buffer.lastIndexOf('<');
    const cut = (lastLt >= cutBase) ? lastLt : cutBase;
    const s = buffer.slice(0, cut);
    buffer = buffer.slice(cut);
    return scanChunk(s);
  };

  const scanChunk = (s: string): InlineThinkingEvent[] => {
    const out: InlineThinkingEvent[] = [];

    let i = 0;
    let lastTextStart = 0;

    const flushText = (end: number) => {
      const piece = s.slice(lastTextStart, end);
      if (!piece) return;
      if (inThink) out.push({ type: 'think_token', text: piece });
      else out.push(...eventsFromPlain(piece));
    };

    while (i < s.length) {
      // 优先级最高：检查 </think> 闭合标签
      // 即使在代码块(inFence)中，如果遇到了 </think>，也强制结束思考
      // 这能解决模型在思考中写代码未闭合就直接结束思考导致 </think> 泄漏的问题
      if (inThink && s.startsWith(CLOSE, i)) {
        flushText(i);
        out.push({ type: 'think_end', mode: 'think_tag' });
        inThink = false;
        // 强制重置代码块状态，因为思考已结束
        inFence = false;
        inInline = false;
        i += CLOSE.length;
        lastTextStart = i;
        continue;
      }

      // 其次：检查 <think> 开始标签
      // 只有不在代码区域时才识别 <think>（避免把代码里的 <think> 当作标签）
      if (!inFence && !inInline && !inThink && s.startsWith(OPEN, i)) {
        flushText(i);
        out.push({ type: 'think_start', mode: 'think_tag' });
        inThink = true;
        i += OPEN.length;
        lastTextStart = i;
        continue;
      }

      // 最后：处理代码标记
      const step = updateCodeState(s, i);
      if (step > 0) {
        // 代码标记处理...
        // 这里不需要做特殊处理，因为如果它是 </think> 的一部分，上面已经拦截了
        // 如果它只是普通的 ` 或 ```，就按原逻辑处理
        flushText(i);
        const mark = s.slice(i, i + step);
        if (inThink) out.push({ type: 'think_token', text: mark });
        else out.push({ type: 'text', text: mark });
        i += step;
        lastTextStart = i;
        continue;
      }

      i += 1;
    }

    // 处理扫描段落的尾部
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
        // 未闭合：把剩余内容当作 think_token，并补一个 think_end（保底收尾）
        out.push({ type: 'think_token', text: rest });
        out.push({ type: 'think_end', mode: 'think_tag' });
        inThink = false;
      } else {
        out.push({ type: 'text', text: rest });
      }
      return out;
    },
  };
}


