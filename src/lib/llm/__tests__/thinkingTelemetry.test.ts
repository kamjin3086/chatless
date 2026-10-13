import { describe, expect, it } from 'vitest';
import {
  buildThinkingTurn,
  formatThinkingDuration,
  mergeThinkingTurn,
  formatThinkingTokens,
  parseThinkingUsage,
} from '../thinkingTelemetry';

describe('reading usage out of a provider response', () => {
  it('reads the OpenAI shape, reasoning tokens included', () => {
    expect(
      parseThinkingUsage({
        prompt_tokens: 1200,
        completion_tokens: 800,
        completion_tokens_details: { reasoning_tokens: 640 },
      }),
    ).toEqual({
      promptTokens: 1200,
      completionTokens: 800,
      reasoningTokens: 640,
    });
  });

  it('reads the newer field name some gateways use', () => {
    expect(
      parseThinkingUsage({
        input_tokens: 10,
        output_tokens: 20,
        output_tokens_details: { reasoning_tokens: 5 },
      }),
    ).toEqual({ promptTokens: 10, completionTokens: 20, reasoningTokens: 5 });
  });

  it('reads Gemini, which calls thinking something else', () => {
    expect(
      parseThinkingUsage({
        promptTokenCount: 900,
        candidatesTokenCount: 300,
        thoughtsTokenCount: 210,
      }),
    ).toEqual({
      promptTokens: 900,
      completionTokens: 300,
      reasoningTokens: 210,
    });
  });

  it('keeps "zero" apart from "not reported"', () => {
    // A provider that bills no thinking and a provider that says nothing are different
    // answers, and the difference is the whole point of the "not reported" state.
    expect(
      parseThinkingUsage({ prompt_tokens: 5, completion_tokens: 6 }),
    ).toEqual({
      promptTokens: 5,
      completionTokens: 6,
      reasoningTokens: undefined,
    });
    expect(
      parseThinkingUsage({
        prompt_tokens: 5,
        completion_tokens: 6,
        completion_tokens_details: { reasoning_tokens: 0 },
      }).reasoningTokens,
    ).toBe(0);
  });

  it('shrugs at nothing', () => {
    expect(parseThinkingUsage(undefined)).toEqual({});
    expect(parseThinkingUsage('nope')).toEqual({});
    expect(parseThinkingUsage({ prompt_tokens: 'x' })).toEqual({});
  });
});

const AT = 1_700_000_000_000;

describe('one turn record', () => {
  it('names the carrier the level actually travelled on', () => {
    const turn = buildThinkingTurn({
      provider: 'openai',
      model: 'gpt-5.8',
      level: 'medium',
      startedAt: AT,
      endedAt: AT + 2_500,
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        completion_tokens_details: { reasoning_tokens: 30 },
      },
    });
    expect(turn.carrier).toBe('reasoning_effort');
    expect(turn.sent).toBe(true);
    expect(turn.durationMs).toBe(2_500);
    expect(turn.reasoningTokens).toBe(30);
    expect(turn.usageReported).toBe(true);
  });

  it('says plainly when nothing was sent', () => {
    const turn = buildThinkingTurn({
      provider: 'openai',
      model: 'gpt-5.8',
      level: 'auto',
      startedAt: AT,
      endedAt: AT + 100,
      usage: undefined,
    });
    expect(turn.sent).toBe(false);
    expect(turn.carrier).toBe(null);
    expect(turn.usageReported).toBe(false);
    expect(turn.reasoningTokens).toBeUndefined();
  });

  it('records a level the model cannot take as not sent', () => {
    // A saved tier the model does not advertise is reported, not repaired (#100); the
    // telemetry must agree with what went out rather than what was stored.
    const turn = buildThinkingTurn({
      provider: 'openai',
      model: 'gpt-5.8',
      level: 'max',
      startedAt: AT,
      endedAt: AT + 100,
      usage: undefined,
    });
    expect(turn.sent).toBe(false);
  });
});

function turn(over: Partial<ReturnType<typeof buildThinkingTurn>>) {
  return {
    at: AT,
    provider: 'openai',
    model: 'gpt-5.8',
    level: 'low',
    sent: true,
    carrier: 'reasoning_effort',
    durationMs: 1000,
    usageReported: true,
    ...over,
  } as ReturnType<typeof buildThinkingTurn>;
}

describe('reading the numbers out loud', () => {
  it('turns milliseconds into something a person compares', () => {
    expect(formatThinkingDuration(900)).toBe('0.9s');
    expect(formatThinkingDuration(2_500)).toBe('2.5s');
    expect(formatThinkingDuration(65_000)).toBe('1m 05s');
    expect(formatThinkingDuration(0)).toBe('0s');
  });

  it('groups tokens by thousands and says nothing when nothing was reported', () => {
    expect(formatThinkingTokens(1234)).toBe('1,234');
    expect(formatThinkingTokens(0)).toBe('0');
    expect(formatThinkingTokens(undefined)).toBe('—');
  });
});

describe('one answer, several model requests', () => {
  const round = (over: Partial<ReturnType<typeof buildThinkingTurn>>) =>
    ({
      at: AT,
      provider: 'openai-compatible',
      model: 'Qwen',
      level: 'low',
      sent: true,
      carrier: 'reasoning_effort',
      durationMs: 1000,
      usageReported: true,
      promptTokens: 100,
      completionTokens: 20,
      reasoningTokens: 5,
      messageId: 'answer-1',
      ...over,
    }) as ReturnType<typeof buildThinkingTurn>;

  it('adds the rounds of one answer together', () => {
    const merged = mergeThinkingTurn(
      round({
        durationMs: 3000,
        promptTokens: 100,
        completionTokens: 20,
        reasoningTokens: 100,
      }),
      round({
        durationMs: 2000,
        promptTokens: 150,
        completionTokens: 30,
        reasoningTokens: 50,
      }),
    );
    expect(merged.durationMs).toBe(5000);
    expect(merged.promptTokens).toBe(250);
    expect(merged.completionTokens).toBe(50);
    expect(merged.reasoningTokens).toBe(150);
    expect(merged.messageId).toBe('answer-1');
  });

  it('does not let a silent round erase a reported count', () => {
    const merged = mergeThinkingTurn(
      round({ reasoningTokens: 100, promptTokens: 100 }),
      round({
        reasoningTokens: undefined,
        promptTokens: undefined,
        usageReported: false,
      }),
    );
    expect(merged.reasoningTokens).toBe(100);
    expect(merged.promptTokens).toBe(100);
    expect(merged.usageReported).toBe(true);
  });

  it('says nothing happened to be reported when no round reported', () => {
    const merged = mergeThinkingTurn(
      round({
        usageReported: false,
        promptTokens: undefined,
        reasoningTokens: undefined,
      }),
      round({
        usageReported: false,
        promptTokens: undefined,
        reasoningTokens: undefined,
      }),
    );
    expect(merged.promptTokens).toBeUndefined();
    expect(merged.usageReported).toBe(false);
  });

  it('takes the counts from whichever round reported them', () => {
    const merged = mergeThinkingTurn(
      round({
        usageReported: false,
        promptTokens: undefined,
        reasoningTokens: undefined,
      }),
      round({ usageReported: true, promptTokens: 90, reasoningTokens: 40 }),
    );
    expect(merged.usageReported).toBe(true);
    expect(merged.promptTokens).toBe(90);
    expect(merged.reasoningTokens).toBe(40);
  });

  it('keeps the level that was actually sent', () => {
    const merged = mergeThinkingTurn(
      round({ level: 'auto', sent: false, carrier: undefined }),
      round({ level: 'high', sent: true, carrier: 'reasoning_effort' }),
    );
    expect(merged.level).toBe('high');
    expect(merged.sent).toBe(true);
  });
});
