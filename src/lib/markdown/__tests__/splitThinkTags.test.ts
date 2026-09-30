import { describe, expect, it } from 'vitest';
import { extractThinkAndRegular, splitThinkFromMarkdown } from '@/lib/markdown/splitThinkTags';

describe('splitThinkFromMarkdown', () => {
  it('splits repeated per-token think tags out of visible text', () => {
    const raw = '<think>用户</think><think>发送</think><think>了一个</think>你好';
    const parts = splitThinkFromMarkdown(raw);
    expect(parts.filter((p) => p.type === 'text').map((p) => p.text).join('')).toBe('你好');
    expect(parts.filter((p) => p.type === 'think').map((p) => p.text)).toEqual(['用户\n发送\n了一个']);
  });

  it('extracts thinking and regular content for historical messages', () => {
    const { thinkingContent, regularContent } = extractThinkAndRegular(
      '前缀<think>a</think><think>b</think>回复'
    );
    expect(thinkingContent).toBe('a\nb');
    expect(regularContent).toBe('前缀回复');
  });

  it('keeps unclosed think tail as thinking, not markdown', () => {
    const { thinkingContent, regularContent } = extractThinkAndRegular('hi<think>还在想');
    expect(regularContent).toBe('hi');
    expect(thinkingContent).toBe('还在想');
  });
});
