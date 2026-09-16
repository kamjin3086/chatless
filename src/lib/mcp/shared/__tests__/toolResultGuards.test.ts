import { describe, expect, it } from 'vitest';
import { classifyToolResult } from '@/lib/mcp/shared/toolResultGuards';
import { dedupeEnvelopeSystemPrefix } from '@/lib/mcp/agentLoop/buildAgentPromptEnvelope';

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

describe('dedupeEnvelopeSystemPrefix', () => {
  it('removes system lines contained in envelope prefix blob', () => {
    const prefix = [{ role: 'system', content: 'env-a\n\nenv-b' }] as any[];
    const history = [
      { role: 'system', content: 'env-a' },
      { role: 'system', content: 'user-custom-prompt' },
      { role: 'user', content: 'hi' },
    ] as any[];
    const out = dedupeEnvelopeSystemPrefix(history, prefix);
    expect(out.map((m) => m.content)).toEqual(['user-custom-prompt', 'hi']);
  });
});
