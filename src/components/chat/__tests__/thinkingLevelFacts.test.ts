import { describe, expect, it } from 'vitest';
import { hasThinkingEvidence } from '../ThinkingLevelFacts';

describe('did this answer actually think', () => {
  it('counts a think segment with content', () => {
    expect(
      hasThinkingEvidence({
        segments: [
          { kind: 'text', text: '答' },
          { kind: 'think', text: '先想想' },
        ],
      }),
    ).toBe(true);
  });

  it('does not count an empty think segment', () => {
    expect(
      hasThinkingEvidence({ segments: [{ kind: 'think', text: '   ' }] }),
    ).toBe(false);
  });

  it('accepts a saved thinking duration from before segments were stored', () => {
    expect(hasThinkingEvidence({ thinkingDuration: 3 })).toBe(true);
    expect(hasThinkingEvidence({ thinkingDuration: 0 })).toBe(false);
  });

  it('says no for a plain answer, and for nothing at all', () => {
    expect(
      hasThinkingEvidence({
        segments: [{ kind: 'text', text: '答' }, { kind: 'toolCard' }],
      }),
    ).toBe(false);
    expect(hasThinkingEvidence({})).toBe(false);
  });
});
