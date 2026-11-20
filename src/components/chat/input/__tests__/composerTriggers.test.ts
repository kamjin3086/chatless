import { describe, expect, it } from 'vitest';
import {
  composerTriggers,
  findComposerQuery,
  insertComposerTrigger,
  replaceComposerQuery,
} from '../composerTriggers';

const findAtEnd = (text: string) => findComposerQuery(text, text.length);

describe('composer triggers', () => {
  it.each([
    ['/', 'skill-id'],
    ['#', '中文提示词'],
    ['@', 'README.md'],
  ])('recognizes a %s query at a token boundary', (trigger, query) => {
    const text = `Draft ${trigger}${query}`;
    expect(findAtEnd(text)).toEqual({
      trigger,
      query,
      start: 6,
      end: text.length,
    });
  });

  it.each([
    'name@example.com',
    'https://example.com/docs',
    'line#123',
    '/var/log',
    '# Heading',
  ])('does not open for ordinary text: %s', (text) => {
    expect(findAtEnd(text)).toBeNull();
  });

  it.each(Object.values(composerTriggers))(
    'opens the same %s picker from the menu at a selection',
    (trigger) => {
      const next = insertComposerTrigger(
        'before selected after',
        7,
        15,
        trigger,
      );
      expect(next).toEqual({ text: `before ${trigger} after`, caret: 8 });
      expect(findComposerQuery(next.text, next.caret)).toEqual({
        trigger,
        query: '',
        start: 7,
        end: 8,
      });
    },
  );

  it('keeps existing text when choosing a prompt from a menu inserted at the start', () => {
    const next = insertComposerTrigger('Existing draft', 0, 0, '#');
    const query = findComposerQuery(next.text, next.caret);
    expect(
      query && replaceComposerQuery(next.text, query, 'Prompt text'),
    ).toEqual({ text: 'Prompt text Existing draft', caret: 11 });
  });

  it.each(['|', '｜'])(
    'keeps trailing prose after filling a prompt with argument values and %s',
    (delimiter) => {
      const text = `#translate English ${delimiter} 后续文字`;
      const query = findComposerQuery(text, text.indexOf(delimiter));
      expect(query?.query.trim()).toBe('translate English');
      expect(
        query && replaceComposerQuery(text, query, 'Translate into English'),
      ).toEqual({ text: 'Translate into English\n后续文字', caret: 22 });
      expect(findAtEnd(text)).toBeNull();
    },
  );

  it.each([
    ['/example', 3, '/chosen '],
    ['@example.md', 3, '"/work/chosen.md" '],
    ['#example', 3, 'Rendered prompt '],
  ])(
    'replaces the whole %s token when the caret is in the middle',
    (token, caretInToken, replacement) => {
      const text = `Draft ${token} after`;
      const query = findComposerQuery(text, 'Draft '.length + caretInToken);
      expect(query && replaceComposerQuery(text, query, replacement)).toEqual({
        text: `Draft ${replacement}after`,
        caret: 'Draft '.length + replacement.length,
      });
    },
  );

  it('does not open the skill picker while editing an absolute path', () => {
    expect(findComposerQuery('Read /var/log', 'Read /var'.length)).toBeNull();
  });

  it('does not consume a literal pipe following an inline prompt', () => {
    const text = 'Draft #prompt|after';
    const query = findComposerQuery(text, text.indexOf('|'));
    expect(query && replaceComposerQuery(text, query, 'Prompt')?.text).toBe(
      'Draft Prompt|after',
    );
  });

  it('replaces only the active mention when a draft has other mentions', () => {
    const text = '@server compare @rep with the current text';
    const query = findComposerQuery(text, text.indexOf(' with'));
    expect(
      query && replaceComposerQuery(text, query, '"/work/report draft.md"'),
    ).toEqual({
      text: '@server compare "/work/report draft.md" with the current text',
      caret: 39,
    });
  });
});
