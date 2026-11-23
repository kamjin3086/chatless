import type { Locale } from '@/i18n/types';

const chineseHeading = '## zh-CN';
const englishHeading = '## en-US';

export function selectReleaseNotes(body: string, locale: Locale): string {
  const lines = body.split('\n');
  const headings: { index: number; text: string }[] = [];
  let fence: string | undefined;
  let inComment = false;
  for (const [index, line] of lines.entries()) {
    const text = line.replace(/\r$/, '');
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
    if (fence) {
      if (
        marker &&
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      ) {
        fence = undefined;
      }
      continue;
    }
    if (inComment || /^ {0,3}<!--/.test(text)) {
      inComment = !text.includes('-->');
      continue;
    }
    if (marker && (marker[1][0] === '~' || !marker[2].includes('`'))) {
      fence = marker[1];
      continue;
    }
    if (/^ {0,3}#{1,2}(?:[ \t]|$)/.test(text)) headings.push({ index, text });
  }

  // The publisher reserves one exact locale pair at the end of the body.
  const [zh, en] = headings.slice(-2);
  if (
    fence ||
    inComment ||
    zh?.text !== chineseHeading ||
    en?.text !== englishHeading ||
    headings
      .slice(0, -2)
      .some(({ text }) => text === chineseHeading || text === englishHeading)
  ) {
    return body;
  }

  const chinese = lines
    .slice(zh.index + 1, en.index)
    .join('\n')
    .trim();
  const english = lines
    .slice(en.index + 1)
    .join('\n')
    .trim();
  if (
    [chinese, english].some(
      (notes) => !notes.replace(/<!--[\s\S]*?-->/g, '').trim(),
    )
  ) {
    return body;
  }
  return locale === 'en' ? english : chinese;
}
