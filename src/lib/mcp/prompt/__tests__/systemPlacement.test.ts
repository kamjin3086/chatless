import { describe, expect, it } from 'vitest';
import { enforceSingleLeadingSystem } from '../systemPlacement';

const message = (role: 'system' | 'user' | 'assistant', content: string) => ({ role, content });

describe('enforceSingleLeadingSystem', () => {
  it('merges a system note that landed after a conversation turn into the leading prompt', () => {
    // Regression: the regeneration note used to be a system message placed
    // before the current user turn, which providers reject with
    // "message N has role 'system' after a non-system turn".
    const input = [
      message('system', 'contract'),
      message('user', 'hi'),
      message('assistant', 'hello'),
      message('system', '[Tool results from the previous run]'),
      message('user', 'count the images'),
    ];

    const output = enforceSingleLeadingSystem(input);

    expect(output[0]).toEqual({ role: 'system', content: 'contract\n\n[Tool results from the previous run]' });
    expect(output.filter((entry) => entry.role === 'system')).toHaveLength(1);
    expect(output.slice(1).map((entry) => entry.role)).toEqual(['user', 'assistant', 'user']);
    expect(output.at(-1)?.content).toBe('count the images');
  });

  it('keeps a single leading system message untouched', () => {
    const input = [message('system', 'contract'), message('user', 'hi')];

    expect(enforceSingleLeadingSystem(input)).toBe(input);
  });

  it('allows the leading summary system message produced by compaction', () => {
    const input = [
      message('system', 'contract'),
      message('system', '[Conversation summary]'),
      message('user', 'hi'),
    ];

    expect(enforceSingleLeadingSystem(input)).toBe(input);
  });
});
