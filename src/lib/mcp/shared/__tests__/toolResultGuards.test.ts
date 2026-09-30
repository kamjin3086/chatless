import { describe, expect, it } from 'vitest';
import { classifyToolResult } from '@/lib/mcp/shared/toolResultGuards';

describe('classifyToolResult', () => {
  it('treats Cloudflare interstitial as tool_error', () => {
    expect(
      classifyToolResult({ title: 'Just a moment...', content: '', links: [] }),
    ).toBe('tool_error');
  });

  it('treats ok=false without actionable detail as tool_error', () => {
    expect(classifyToolResult({ ok: false })).toBe('tool_error');
  });

  it('keeps ok=false with actionable detail as success (Chat batch ops)', () => {
    expect(classifyToolResult({ ok: false, deletedCount: 2, deleted: ['a.txt'] })).toBe('success');
    expect(classifyToolResult({ ok: false, failed: [{ path: 'b.txt' }] })).toBe('success');
  });

  it('treats skipped pipeline result as tool_error', () => {
    expect(classifyToolResult({ skipped: true })).toBe('tool_error');
  });
});

