import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_OUTPUT_TOKENS, resolveOutputBudget } from '../outputBudget';
import { readContextWindow } from '../modelWindow';

describe('resolveOutputBudget', () => {
  it.each([
    [undefined, 262144, DEFAULT_MAX_OUTPUT_TOKENS],
    [undefined, 32768, 8192],
    [undefined, 8192, 2048],
    [undefined, 4096, 2048],
    [undefined, 1024, 1024],
  ])('user=%s window=%s -> %s', (userMaxTokens, contextWindow, expected) => {
    expect(resolveOutputBudget({ contextWindow, userMaxTokens: userMaxTokens as number | undefined })).toBe(expected);
  });

  it('sends nothing when the window is unknown', () => {
    expect(resolveOutputBudget({})).toBeUndefined();
    expect(resolveOutputBudget({ contextWindow: 0 })).toBeUndefined();
    expect(resolveOutputBudget({ contextWindow: Number.NaN })).toBeUndefined();
  });

  it('lets the user value win but clamps it to the window', () => {
    expect(resolveOutputBudget({ contextWindow: 262144, userMaxTokens: 4096 })).toBe(4096);
    expect(resolveOutputBudget({ contextWindow: 8192, userMaxTokens: 60000 })).toBe(8192);
    // A user value on an unknown-window endpoint is still forwarded: they asked.
    expect(resolveOutputBudget({ userMaxTokens: 1234 })).toBe(1234);
  });
});

describe('readContextWindow', () => {
  it('reads the shapes providers actually report', () => {
    expect(readContextWindow({ id: 'a', context_length: 8192 })).toBe(8192);
    expect(readContextWindow({ id: 'a', context_window: '32768' })).toBe(32768);
    expect(readContextWindow({ id: 'a', meta: { llamaswap: { context: 262144 } } })).toBe(262144);
    expect(readContextWindow({ id: 'a', model_info: { 'llama.context_length': 1 } })).toBeUndefined();
  });

  it('stays undefined when nothing is reported', () => {
    expect(readContextWindow({ id: 'a' })).toBeUndefined();
    expect(readContextWindow(null)).toBeUndefined();
    expect(readContextWindow({ id: 'a', meta: { llamaswap: { context: 'unknown' } } })).toBeUndefined();
  });
});
