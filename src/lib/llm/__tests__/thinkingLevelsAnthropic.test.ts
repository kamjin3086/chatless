/**
 * Anthropic is the provider where the ticket's "effort-based request rather than the
 * deprecated fixed budget" is literal: the migration section of the extended-thinking
 * docs says to drop `budget_tokens` and steer depth with `output_config.effort`.
 *
 * Facts here come from docs.anthropic.com (thinking/effort/extended-thinking pages,
 * fetched 2026-10-13): which levels exist per model, that `off` is spelled `disabled`
 * on most models and `between_tools` on Sonnet 5.5, that Opus 5.5 returns a 400 for
 * `disabled` at every level, and that `disabled`/`between_tools` is a 400 together with
 * `xhigh` or `max` on Opus 5, Sonnet 5.5 and Haiku 5.5.
 */
import { describe, expect, it } from 'vitest';
import { ParameterPolicyEngine } from '../ParameterPolicy';
import {
  anthropicDefaultEffort,
  supportedThinkingLevels,
} from '../thinkingLevels';

const PROVIDER = 'Anthropic';
const apply = (model: string, options: Record<string, any>) =>
  ParameterPolicyEngine.apply(PROVIDER, model, options);

describe('levels become output_config.effort', () => {
  it('carries each level as an effort and never a fixed budget', () => {
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
      const out = apply('claude-opus-5', { thinkingLevel: level });
      expect(out.output_config).toEqual({ effort: level });
      expect(out).not.toHaveProperty('thinkingLevel');
      expect(JSON.stringify(out)).not.toContain('budget_tokens');
      expect(out).not.toHaveProperty('thinking');
    }
  });

  it('offers only the levels that model documents', () => {
    // Opus 4.6 has `max` but not `xhigh`; the docs call that out in so many words.
    // It can still be told not to think, so `off` is on the list.
    expect(supportedThinkingLevels(PROVIDER, 'claude-opus-4-6')).toEqual([
      'off',
      'low',
      'medium',
      'high',
      'max',
    ]);
    expect(supportedThinkingLevels(PROVIDER, 'claude-sonnet-5')).toEqual([
      'off',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(supportedThinkingLevels(PROVIDER, 'claude-opus-4-5')).toEqual([
      'off',
      'low',
      'medium',
      'high',
    ]);
  });

  it('invents no effort for a model that has never had one', () => {
    for (const model of [
      'claude-3-7-sonnet-20250219',
      'claude-sonnet-4-20250514',
      'claude-haiku-4-5-20251001',
      'claude-3-opus-20240229',
    ]) {
      expect(supportedThinkingLevels(PROVIDER, model)).toEqual([]);
      const out = apply(model, { thinkingLevel: 'high' });
      expect(out).not.toHaveProperty('output_config');
      expect(out).not.toHaveProperty('thinking');
    }
  });

  it('leaves an effort the user wrote alone', () => {
    const out = apply('claude-opus-5', {
      thinkingLevel: 'high',
      output_config: { effort: 'low' },
    });
    expect(out.output_config).toEqual({ effort: 'low' });
  });
});

describe('off is an explicit disable, spelled per model', () => {
  it('sends disabled rather than omitting thinking', () => {
    const out = apply('claude-opus-5', { thinkingLevel: 'off' });
    expect(out.thinking).toEqual({ type: 'disabled' });
    expect(out).not.toHaveProperty('output_config');
  });

  it('uses between_tools where that is the lowest setting the model accepts', () => {
    expect(
      apply('claude-sonnet-5-5', { thinkingLevel: 'off' }).thinking,
    ).toEqual({
      type: 'between_tools',
    });
  });

  it('is not offered at all to a model that 400s on every way of turning it off', () => {
    // "Requests that set thinking: {type: disabled} return a 400 error at every effort
    // level" - so the choice is never presented and never sent.
    expect(supportedThinkingLevels(PROVIDER, 'claude-opus-5-5')).not.toContain(
      'off',
    );
    expect(
      apply('claude-opus-5-5', { thinkingLevel: 'off' }),
    ).not.toHaveProperty('thinking');
  });
});

describe('what the model thinks by default', () => {
  it('is the level that costs nothing to change to', () => {
    // Opus 5.5 and Haiku 5.5 default to medium; everything else with effort defaults
    // to high. This is what the cache notice has to compare against.
    expect(anthropicDefaultEffort('claude-opus-5-5')).toBe('medium');
    expect(anthropicDefaultEffort('claude-haiku-5-5')).toBe('medium');
    expect(anthropicDefaultEffort('claude-opus-5')).toBe('high');
    expect(anthropicDefaultEffort('claude-sonnet-4-6')).toBe('high');
    expect(anthropicDefaultEffort('claude-3-7-sonnet-20250219')).toBeNull();
  });
});
