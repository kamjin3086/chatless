import { describe, expect, it } from 'vitest';
import { convertHtmlBreaksToMd, escapeControlTags, splitOpenFence } from '../streamTextPrep';

describe('splitOpenFence', () => {
  it('returns everything as settled when no code block is open', () => {
    const text = '段落一\n\n段落二';
    expect(splitOpenFence(text)).toEqual({ settled: text, open: null });
  });

  it('keeps a closed code block inside the settled text', () => {
    const text = '说明\n\n```ts\nconst a = 1;\n```\n\n后续';
    expect(splitOpenFence(text)).toEqual({ settled: text, open: null });
  });

  it('splits the trailing open code block out of the settled text', () => {
    const text = '说明\n\n```ts\nconst a = 1;\nconst b = 2;';
    expect(splitOpenFence(text)).toEqual({
      settled: '说明\n',
      open: { lang: 'ts', code: 'const a = 1;\nconst b = 2;' },
    });
  });

  it('treats a second fence as the closing one', () => {
    const text = '```\ncode\n```\n\n正文';
    expect(splitOpenFence(text).open).toBeNull();
  });

  it('reports an unknown language as text', () => {
    const text = '```\nplain';
    expect(splitOpenFence(text).open).toEqual({ lang: 'text', code: 'plain' });
  });
});

describe('stream text preparation', () => {
  it('escapes control tags that occupy a whole line', () => {
    expect(escapeControlTags('前\n</final_answer>\n后')).toBe('前\n&lt;/final_answer&gt;\n后');
  });

  it('leaves real html alone', () => {
    expect(escapeControlTags('<html><body>x</body></html>')).toBe('<html><body>x</body></html>');
  });

  it('converts html breaks into markdown hard breaks', () => {
    expect(convertHtmlBreaksToMd('a<br>b<br/>c')).toBe('a  \nb  \nc');
  });
});
