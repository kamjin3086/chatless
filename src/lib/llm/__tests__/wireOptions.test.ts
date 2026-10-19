/**
 * The options bag that reaches a provider is this app's working set, not the wire body.
 * #151 was that distinction going missing: NVIDIA NIM answered
 * `Validation: Unsupported parameter(s): __schedulerLease, __requestId, streaming` because
 * every provider spread the bag into its request body behind a four-key denylist.
 *
 * These are the rules for what may cross that boundary. The provider tests next to this
 * file assert the same thing against each request body, which is where a regression would
 * be visible.
 */
import { describe, expect, it } from 'vitest';
import { isAppOnlyOption, toWireOptions } from '../wireOptions';

describe('app options never become wire fields', () => {
  it('drops what only this app reads', () => {
    expect(
      toWireOptions({
        temperature: 0.4,
        streaming: true,
        conversationId: 'conversation-1',
        messageId: 'message-1',
        contextWindowTokens: 8192,
        thinkingModelSuffixes: ['-thinking'],
        thinkingLevel: 'high',
        __schedulerLease: true,
        __requestId: 'request-1',
        __signal: undefined,
        __priority: 'low',
        __internal: true,
        __silentMode: true,
      }),
    ).toEqual({ temperature: 0.4 });
  });

  it('drops the parameter names this app invents and a provider renames', () => {
    expect(
      toWireOptions({
        maxTokens: 300,
        maxOutputTokens: 300,
        topP: 0.9,
        topK: 40,
        minP: 0.05,
        frequencyPenalty: 0.1,
        presencePenalty: 0.2,
        stop: ['<|im_end|>'],
        stopSequences: ['<|im_end|>'],
        numPredict: 300,
        numCtx: 8192,
        repeatLastN: 64,
        repeatPenalty: 1.1,
      }),
    ).toEqual({});
  });

  it('drops the app-shaped payloads a provider rebuilds', () => {
    expect(
      toWireOptions({
        tools: [{ name: 'read_file' }],
        toolChoice: 'auto',
        parallelToolCalls: true,
        extensions: { mcpServers: [] },
        mcpServers: [],
        options: { seed: 1 },
      }),
    ).toEqual({});
  });

  it('keeps fields that are already wire names, including provider-native ones', () => {
    expect(
      toWireOptions({
        temperature: 0,
        max_tokens: 300,
        top_p: 0.9,
        stream: false,
        thinking: { type: 'enabled', budget_tokens: 4000 },
        reasoning_effort: 'high',
        response_format: { type: 'json_object' },
      }),
    ).toEqual({
      temperature: 0,
      max_tokens: 300,
      top_p: 0.9,
      stream: false,
      thinking: { type: 'enabled', budget_tokens: 4000 },
      reasoning_effort: 'high',
      response_format: { type: 'json_object' },
    });
  });

  it('reads an absent bag as no options', () => {
    expect(toWireOptions(undefined)).toEqual({});
    expect(toWireOptions(null)).toEqual({});
  });

  it('names the rule the providers share', () => {
    expect(isAppOnlyOption('__requestId')).toBe(true);
    expect(isAppOnlyOption('maxTokens')).toBe(true);
    expect(isAppOnlyOption('max_tokens')).toBe(false);
    expect(isAppOnlyOption('temperature')).toBe(false);
  });
});
