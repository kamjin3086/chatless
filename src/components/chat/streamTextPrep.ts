/**
 * 流式正文进 Markdown 渲染器之前的纯文本处理。
 *
 * 抽成独立模块：不依赖 React/streamdown，便于单元测试，也让渲染组件只负责渲染。
 */

/**
 * 只作为单行出现的控制标签（如 </final_answer>）会被当作 HTML 丢掉，导致视觉缺行。
 * 仅在整行就是该标签时转义；不碰正常 HTML 代码（<head>/<body> 等）。
 */
const ESCAPE_TAG_NAMES = new Set([
  'final_answer',
  'analysis',
  'commentary',
  'assistant',
  'user',
  'system',
  'think',
  'reasoning',
]);

export function escapeControlTags(input: string): string {
  return String(input || '').replace(/^(<\/?)([\w:-]+)>\s*$/gm, (match, _prefix, tagName) => {
    const name = String(tagName || '').toLowerCase();
    if (!ESCAPE_TAG_NAMES.has(name)) return match;
    return match.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  });
}

/** HTML 换行 <br> 预处理 → Markdown 硬换行。 */
export function convertHtmlBreaksToMd(input: string): string {
  return String(input || '')
    .replace(/<br\s*\/>/gi, '  \n')
    .replace(/<br\s*>/gi, '  \n');
}

/**
 * 把"尚未闭合的代码块"从正文里切出来。
 *
 * 流式期间代码块每新增一行都会让 streamdown 用 shiki 重新高亮一次（明暗两套），
 * 长代码块因此是 O(n²) 的重复高亮；切出来之后 streamdown 只看得到已闭合的前缀，
 * 在代码块流式期间几乎不工作，闭合后一次性高亮。
 */
export function splitOpenFence(text: string): {
  settled: string;
  open: { lang: string; code: string } | null;
} {
  const source = String(text || '');
  const lines = source.split('\n');
  let openIndex = -1;
  let lang = '';

  for (let i = 0; i < lines.length; i += 1) {
    const match = /^\s*```(.*)$/.exec(lines[i]);
    if (!match) continue;
    if (openIndex === -1) {
      openIndex = i;
      lang = String(match[1] || '').trim();
    } else {
      openIndex = -1;
      lang = '';
    }
  }

  if (openIndex === -1) return { settled: source, open: null };
  return {
    settled: lines.slice(0, openIndex).join('\n'),
    open: { lang: lang || 'text', code: lines.slice(openIndex + 1).join('\n') },
  };
}
