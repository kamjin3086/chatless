import { describe, expect, it } from 'vitest';
import { parseCompactToolJson, splitTextAndToolJson } from '@/lib/chat/compactToolJson';

describe('compactToolJson', () => {
  it('parses web_search style JSON', () => {
    const raw = JSON.stringify({
      name: 'web_search',
      arguments: { query: '2026-07-09 杭州天气' },
    });
    const parsed = parseCompactToolJson(raw);
    expect(parsed?.name).toBe('web_search');
    expect(parsed?.summary).toContain('杭州');
  });

  it('splits fenced tool JSON from surrounding text', () => {
    const parts = splitTextAndToolJson('调用如下：\n```json\n{"name":"web_search","arguments":{"query":"test"}}\n```\n完成');
    expect(parts.some((p) => p.type === 'tool')).toBe(true);
    expect(parts.some((p) => p.type === 'text' && p.text.includes('调用'))).toBe(true);
  });
});
