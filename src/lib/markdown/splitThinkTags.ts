export type ThinkSplitPart = { type: 'think' | 'text'; text: string };

const THINK_BLOCK = /<think>([\s\S]*?)<\/think>/gi;
const THINK_OPEN = /<think>/i;

/**
 * 将正文中的全部 <think>...</think> 拆成 think / text 段。
 * 旧消息可能把每个词都包一层 think；只剥第一对会导致标签漏到 Markdown。
 */
export function splitThinkFromMarkdown(content: string): ThinkSplitPart[] {
  if (!content) return [];
  const out: ThinkSplitPart[] = [];
  const re = new RegExp(THINK_BLOCK.source, 'gi');
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    if (match.index > last) {
      pushText(out, content.slice(last, match.index));
    }
    pushThink(out, match[1] || '');
    last = match.index + match[0].length;
  }
  const rest = content.slice(last);
  if (!rest) return mergeAdjacent(out);

  const openIdx = rest.search(THINK_OPEN);
  if (openIdx >= 0) {
    pushText(out, rest.slice(0, openIdx));
    pushThink(out, rest.slice(openIdx + 7));
  } else {
    pushText(out, rest);
  }
  return mergeAdjacent(out);
}

export function extractThinkAndRegular(content: string): {
  thinkingContent: string;
  regularContent: string;
} {
  const parts = splitThinkFromMarkdown(content);
  return {
    thinkingContent: parts.filter((p) => p.type === 'think').map((p) => p.text).join('\n').trim(),
    regularContent: parts.filter((p) => p.type === 'text').map((p) => p.text).join('').trim(),
  };
}

function pushText(out: ThinkSplitPart[], text: string) {
  if (text) out.push({ type: 'text', text });
}

function pushThink(out: ThinkSplitPart[], text: string) {
  if (text) out.push({ type: 'think', text });
}

function mergeAdjacent(parts: ThinkSplitPart[]): ThinkSplitPart[] {
  const merged: ThinkSplitPart[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (last && last.type === part.type) {
      last.text += part.type === 'think' ? `\n${part.text}` : part.text;
    } else {
      merged.push({ ...part });
    }
  }
  return merged;
}
