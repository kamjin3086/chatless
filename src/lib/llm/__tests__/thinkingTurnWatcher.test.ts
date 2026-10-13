import { describe, expect, it } from 'vitest';
import { createThinkingTurnWatcher } from '../thinkingTelemetry';

const T0 = 1_700_000_000_000;

describe('watching one run for cost', () => {
  it('uses the last usage frame a provider sent', () => {
    const watcher = createThinkingTurnWatcher({
      startedAt: T0,
      now: () => T0 + 4_200,
      context: () => ({ provider: 'openai', model: 'gpt-5.8', level: 'low' }),
    });
    watcher.noteUsage({ prompt_tokens: 10, completion_tokens: 1 });
    watcher.noteUsage({
      prompt_tokens: 1200,
      completion_tokens: 800,
      completion_tokens_details: { reasoning_tokens: 500 },
    });
    expect(watcher.finish()).toMatchObject({
      provider: 'openai',
      model: 'gpt-5.8',
      level: 'low',
      durationMs: 4_200,
      promptTokens: 1200,
      reasoningTokens: 500,
    });
  });

  it('still records a turn when the endpoint never reported usage', () => {
    const watcher = createThinkingTurnWatcher({
      startedAt: T0,
      now: () => T0 + 500,
      context: () => ({ provider: 'openai', model: 'gpt-5.8', level: 'high' }),
    });
    expect(watcher.finish()).toMatchObject({
      usageReported: false,
      durationMs: 500,
      sent: true,
    });
  });

  it('carries the message and conversation the turn belongs to', () => {
    const watcher = createThinkingTurnWatcher({
      startedAt: T0,
      now: () => T0 + 10,
      context: () => ({
        provider: 'openai',
        model: 'gpt-5.8',
        level: 'low',
        conversationId: 'c1',
        messageId: 'm1',
      }),
    });
    expect(watcher.finish()).toMatchObject({
      conversationId: 'c1',
      messageId: 'm1',
    });
  });

  it('does not invent a level the run did not have', () => {
    const watcher = createThinkingTurnWatcher({
      startedAt: T0,
      now: () => T0 + 10,
      context: () => ({
        provider: 'openai',
        model: 'gpt-5.8',
        level: undefined,
      }),
    });
    expect(watcher.finish()).toMatchObject({ level: 'auto', sent: false });
  });
});
