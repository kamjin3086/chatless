/**
 * The dialog has to refuse a combination the API will refuse, and say which one, instead
 * of adjusting one of the two numbers on the user's behalf (#98). Everything here is a
 * pure decision so the rule can be read, tested, and reused by the session-scoped
 * dialog later; the strings are i18n keys, never prose baked into logic.
 */
import { describe, expect, it } from 'vitest';
import {
  thinkingCacheNotice,
  validateThinkingRequest,
} from '../thinkingRequestValidation';

const P = 'Anthropic';

describe('what the dialog refuses to save', () => {
  it('a level that is a documented 400 with thinking off', () => {
    // Opus 5: `thinking: disabled` is rejected at xhigh and max.
    const blocked = validateThinkingRequest({
      providerName: P,
      modelId: 'claude-opus-5',
      level: 'off',
      maxOutputTokens: 8192,
      advanced: { output_config: { effort: 'xhigh' } },
    });
    expect(blocked).toMatchObject({
      kind: 'blocked',
      key: 'modelParams.thinking.conflictEffortDisabled',
    });
    // The messages are static i18n keys, so the rule has to be identifiable
    // from the key alone; a param would be prose leaking into logic.
    expect(
      validateThinkingRequest({
        providerName: P,
        modelId: 'claude-haiku-5-5',
        level: 'off',
        maxOutputTokens: 8192,
        advanced: { output_config: { effort: 'max' } },
      })?.kind,
    ).toBe('blocked');
  });

  it('a way of turning thinking off that this model does not have at all', () => {
    expect(
      validateThinkingRequest({
        providerName: P,
        modelId: 'claude-opus-5-5',
        level: 'off',
        maxOutputTokens: 8192,
      }),
    ).toMatchObject({
      kind: 'blocked',
      key: 'modelParams.thinking.conflictDisabledUnsupported',
    });
  });

  it('a manual budget that leaves no room for the answer, or is below the floor', () => {
    expect(
      validateThinkingRequest({
        providerName: P,
        modelId: 'claude-opus-4-5',
        level: 'auto',
        maxOutputTokens: 8192,
        advanced: { thinking: { type: 'enabled', budget_tokens: 9000 } },
      }),
    ).toMatchObject({
      kind: 'blocked',
      key: 'modelParams.thinking.conflictBudgetAboveMax',
    });
    expect(
      validateThinkingRequest({
        providerName: P,
        modelId: 'claude-opus-4-5',
        level: 'auto',
        maxOutputTokens: 8192,
        advanced: { thinking: { type: 'enabled', budget_tokens: 512 } },
      }),
    ).toMatchObject({
      kind: 'blocked',
      key: 'modelParams.thinking.conflictBudgetTooSmall',
    });
  });

  it('leaves an ordinary request alone', () => {
    expect(
      validateThinkingRequest({
        providerName: P,
        modelId: 'claude-opus-5',
        level: 'off',
        maxOutputTokens: 8192,
      }),
    ).toBeNull();
    expect(
      validateThinkingRequest({
        providerName: P,
        modelId: 'claude-sonnet-5',
        level: 'high',
        maxOutputTokens: 16000,
      }),
    ).toBeNull();
  });

  it('is not the place where another provider gets rules', () => {
    expect(
      validateThinkingRequest({
        providerName: 'Ollama',
        modelId: 'qwen3:32b',
        level: 'off',
        maxOutputTokens: 8192,
        advanced: { output_config: { effort: 'max' } },
      }),
    ).toBeNull();
  });
});

describe('what the dialog warns about instead', () => {
  it('a deep level with an output limit thinking is likely to eat', () => {
    // "max_tokens is a hard cap that includes thinking"; at xhigh/max the docs suggest
    // starting near 64k. Worth a sentence, not a refusal: the request is legal.
    expect(
      validateThinkingRequest({
        providerName: P,
        modelId: 'claude-opus-5',
        level: 'xhigh',
        maxOutputTokens: 4096,
      }),
    ).toMatchObject({
      kind: 'warn',
      key: 'modelParams.thinking.warnEffortNeedsRoom',
    });
    expect(
      validateThinkingRequest({
        providerName: P,
        modelId: 'claude-opus-5',
        level: 'xhigh',
        maxOutputTokens: 64000,
      }),
    ).toBeNull();
  });

  it('uses the limit the app would send when the user set none', () => {
    // Anthropic requires max_tokens, and this app fills 8192 when unset - so "unset"
    // is not "unlimited" and the warning has to be computed against the real number.
    expect(
      validateThinkingRequest({
        providerName: P,
        modelId: 'claude-opus-5',
        level: 'max',
        maxOutputTokens: undefined,
      })?.kind,
    ).toBe('warn');
  });
});

describe('the prompt-cache consequence', () => {
  it('shows up when the level differs from the model default', () => {
    expect(
      thinkingCacheNotice({
        providerName: P,
        modelId: 'claude-opus-5',
        level: 'low',
      }),
    ).toBe('modelParams.thinking.cacheNotice');
    expect(
      thinkingCacheNotice({
        providerName: P,
        modelId: 'claude-opus-5-5',
        level: 'off',
      }),
    ).toBe('modelParams.thinking.cacheNotice');
  });

  it('stays quiet when nothing would change on the wire', () => {
    // "Setting effort explicitly to the model's default is equivalent to omitting it
    // and does not break the cache."
    expect(
      thinkingCacheNotice({
        providerName: P,
        modelId: 'claude-opus-5',
        level: 'high',
      }),
    ).toBeNull();
    expect(
      thinkingCacheNotice({
        providerName: P,
        modelId: 'claude-haiku-5-5',
        level: 'medium',
      }),
    ).toBeNull();
    expect(
      thinkingCacheNotice({
        providerName: P,
        modelId: 'claude-opus-5',
        level: 'auto',
      }),
    ).toBeNull();
    expect(
      thinkingCacheNotice({
        providerName: 'Ollama',
        modelId: 'qwen3:32b',
        level: 'low',
      }),
    ).toBeNull();
  });
});
