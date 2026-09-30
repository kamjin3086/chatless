import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  MIN_ADAPTIVE_OUTPUT_TOKENS,
  resolveOutputBudget,
  resolveOutputReserve,
} from '../outputBudget';
import { readContextWindow } from '../modelWindow';

describe('resolveOutputBudget', () => {
  it.each([262144, 32768, 8192, 4096, 1024, undefined])(
    'sends nothing when the user did not set a limit (window=%s)',
    (contextWindow) => {
      // 单次能输出多久由服务端决定；客户端不再替模型猜一个上限。
      expect(resolveOutputBudget({ contextWindow })).toBeUndefined();
    },
  );

  it('sends nothing for invalid windows either', () => {
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

describe('resolveOutputReserve', () => {
  it('reserves the floor when the window is unknown', () => {
    expect(resolveOutputReserve({})).toBe(MIN_ADAPTIVE_OUTPUT_TOKENS);
  });

  it('reserves between the floor and the default cap for known windows', () => {
    expect(resolveOutputReserve({ contextWindow: 8192 })).toBe(MIN_ADAPTIVE_OUTPUT_TOKENS);
    expect(resolveOutputReserve({ contextWindow: 262144 })).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
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
