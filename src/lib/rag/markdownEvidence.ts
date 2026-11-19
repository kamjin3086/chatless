/** Apply a text transform outside Markdown code spans/fences. No model output
 * inside code samples is interpreted as a citation, including unfinished fences.
 */
export function mapOutsideMarkdownCode(
  text: string,
  transform: (part: string) => string,
): string {
  const escaped = (index: number) => {
    let slashes = 0;
    while (index > 0 && text[--index] === '\\') slashes++;
    return slashes % 2 === 1;
  };
  const parts: string[] = [];
  let plainStart = 0;
  let index = 0;
  const protect = (end: number) => {
    parts.push(
      transform(text.slice(plainStart, index)),
      text.slice(index, end),
    );
    index = end;
    plainStart = end;
  };
  while (index < text.length) {
    if (index === 0 || text[index - 1] === '\n') {
      const lineEnd = text.indexOf('\n', index);
      const line = text.slice(index, lineEnd < 0 ? text.length : lineEnd);
      const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        const marker = fence[1];
        const close = new RegExp(
          `^ {0,3}${marker[0]}{${marker.length},}[ \\t]*(?:\\r?\\n|$)`,
          'gm',
        );
        close.lastIndex = lineEnd < 0 ? text.length : lineEnd + 1;
        const match = close.exec(text);
        protect(match ? match.index + match[0].length : text.length);
        continue;
      }
    }
    if (text[index] === '`' && !escaped(index)) {
      let length = 1;
      while (text[index + length] === '`') length++;
      let cursor = index + length;
      let end = -1;
      while (cursor < text.length) {
        const next = text.indexOf('`', cursor);
        if (next < 0) break;
        let run = 1;
        while (text[next + run] === '`') run++;
        if (run === length) {
          end = next + run;
          break;
        }
        cursor = next + run;
      }
      if (end >= 0) {
        protect(end);
        continue;
      }
      index += length;
      continue;
    }
    index++;
  }
  parts.push(transform(text.slice(plainStart)));
  return parts.join('');
}
