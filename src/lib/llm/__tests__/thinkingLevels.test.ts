import { describe, expect, it } from 'vitest';
import { translate } from '@/i18n';
import type { TranslationKey } from '@/i18n/types';
import { ParameterPolicyEngine } from '../ParameterPolicy';
import type { ThinkingLevel } from '../thinkingLevels';
import {
  THINKING_LEVEL_ORDER,
  findThinkingMapping,
  supportedThinkingLevels,
  thinkingWireFor,
} from '../thinkingLevels';
import { ModelParametersService } from '@/lib/model-parameters';
import { DEFAULT_MODEL_PARAMETERS } from '@/types/model-params';

/**
 * The thinking-level seam. Vocabulary and mapping data live in thinkingLevels; the
 * translation onto the wire happens in one ParameterPolicy rule, so "which provider
 * gets which field" stays a table rather than a pile of branches.
 *
 * The rules these tests hold: `auto` sends nothing; an unverified model sends nothing
 * (it never silently borrows another model's field); a level is never downgraded to a
 * nearby one; an explicit provider-native value beats the level.
 */
describe('thinking level vocabulary and mapping', () => {
  it('orders the levels from most to least restrained, auto first', () => {
    expect(THINKING_LEVEL_ORDER).toEqual([
      'auto',
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  });

  it('names every level in both locales, not just the one in front of the developer', () => {
    for (const level of THINKING_LEVEL_ORDER) {
      const key = (
        level === 'auto'
          ? 'modelParams.thinkingLevel.auto'
          : `thinkingLevel.${level}`
      ) as TranslationKey;
      expect(translate('zh', key)).not.toBe(key);
      expect(translate('en', key)).not.toBe(key);
    }
  });

  it('requires the provider to match too; a model name alone is not a carrier', () => {
    // `deepseek-r1` looks like a reasoning model, but Ollama is not an OpenAI-compatible
    // gateway and its carrier is a different field entirely, so the honest answer here
    // is "unverified": no tiers offered, nothing sent.
    expect(supportedThinkingLevels('Ollama', 'deepseek-r1:32b')).toEqual([]);
    expect(thinkingWireFor('Ollama', 'deepseek-r1:32b', 'medium')).toBeNull();
    expect(findThinkingMapping('Ollama', 'deepseek-r1:32b')).toBeNull();
    // and the rule sends nothing at all
    const out = ParameterPolicyEngine.apply('Ollama', 'deepseek-r1:32b', {
      thinkingLevel: 'medium',
    });
    expect(out).not.toHaveProperty('reasoning_effort');
    expect(out).not.toHaveProperty('thinkingLevel');
  });

  it('pins every advertised level on the OpenAI row to its exact wire value', () => {
    const expected: Record<string, string> = {
      off: 'none',
      minimal: 'minimal',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
    };
    for (const [level, value] of Object.entries(expected)) {
      expect(
        thinkingWireFor('OpenAI', 'o4-mini', level as ThinkingLevel)?.value,
        level,
      ).toBe(value);
    }
  });

  it('pins which levels the self-hosted row advertises, and which it withholds', () => {
    expect(supportedThinkingLevels('OpenAI Compatible', 'deepseek-r1')).toEqual(
      ['minimal', 'low', 'medium', 'high'],
    );
  });

  it('maps an OpenAI reasoning model onto reasoning_effort', () => {
    const wire = thinkingWireFor('OpenAI', 'o4-mini', 'medium');
    expect(wire).toEqual({
      carrier: 'reasoning_effort',
      field: 'reasoning_effort',
      value: 'medium',
    });
  });

  it('expresses off as the model-side word for "do not think"', () => {
    expect(thinkingWireFor('OpenAI', 'o4-mini', 'off')?.value).toBe('none');
  });

  it('reports no supported levels for a model the table has never seen', () => {
    expect(findThinkingMapping('OpenAI', 'gpt-4o')).toBeNull();
    expect(supportedThinkingLevels('OpenAI', 'gpt-4o')).toEqual([]);
    expect(thinkingWireFor('OpenAI', 'gpt-4o', 'medium')).toBeNull();
  });

  it('does not offer a level a mapped model does not accept', () => {
    // the self-hosted compatible row deliberately does not advertise xhigh; offering it
    // would mean promising a tier the router is not known to serve
    const levels = supportedThinkingLevels('OpenAI Compatible', 'deepseek-r1');
    expect(levels).toContain('high');
    expect(levels).not.toContain('xhigh');
    expect(
      thinkingWireFor('OpenAI Compatible', 'deepseek-r1', 'xhigh'),
    ).toBeNull();
  });
});

describe('thinking level through the parameter policy', () => {
  it('auto sends no thinking field of any kind', () => {
    const out = ParameterPolicyEngine.apply('OpenAI', 'o4-mini', {
      thinkingLevel: 'auto',
    });
    expect(out).not.toHaveProperty('thinkingLevel');
    expect(out).not.toHaveProperty('reasoning_effort');
    expect(out).not.toHaveProperty('reasoningEffort');
  });

  it('a missing level behaves exactly as it did before the concept existed', () => {
    const out = ParameterPolicyEngine.apply('OpenAI', 'o4-mini', {
      temperature: 0.3,
    });
    expect(out).toEqual({ temperature: 0.3 });
  });

  it('translates a level onto the provider field and leaves no generic field behind', () => {
    const out = ParameterPolicyEngine.apply('OpenAI', 'o4-mini', {
      thinkingLevel: 'high',
    });
    expect(out.reasoning_effort).toBe('high');
    expect(out).not.toHaveProperty('thinkingLevel');
  });

  it('never leaks the generic field to an unmapped provider', () => {
    const out = ParameterPolicyEngine.apply('Some Router', 'qwen3-plain', {
      thinkingLevel: 'medium',
    });
    expect(out).not.toHaveProperty('thinkingLevel');
    expect(out).not.toHaveProperty('reasoning_effort');
  });

  it('lets an explicit provider-native value beat the level', () => {
    const out = ParameterPolicyEngine.apply('OpenAI', 'o4-mini', {
      thinkingLevel: 'high',
      reasoning_effort: 'minimal',
    });
    expect(out.reasoning_effort).toBe('minimal');
  });

  it('leaves the older boolean thinking parameter alone', () => {
    const out = ParameterPolicyEngine.apply('Ollama', 'qwen3', {
      thinking: true,
    });
    expect(out.thinking).toBe(true);
  });

  it('does not disturb the pre-existing Gemini thinking budget', () => {
    const out = ParameterPolicyEngine.apply('Google AI', 'gemini-2.5-pro', {});
    expect(out.generationConfig.thinkingConfig.thinkingBudget).toBe(1024);
  });
});

describe('thinking level as a stored model parameter', () => {
  it('is not sent while it stays on auto', () => {
    const opts = ModelParametersService.convertToChatOptions({
      ...DEFAULT_MODEL_PARAMETERS,
    });
    expect(opts).not.toHaveProperty('thinkingLevel');
  });

  it('reaches the wire once enabled, and survives a session override', () => {
    const opts = ModelParametersService.convertToChatOptions({
      ...DEFAULT_MODEL_PARAMETERS,
      enableThinkingLevel: true,
      thinkingLevel: 'low',
    });
    expect(opts.thinkingLevel).toBe('low');
    const composed = ParameterPolicyEngine.apply('OpenAI', 'o4-mini', opts);
    expect(composed.reasoning_effort).toBe('low');
    expect(composed).not.toHaveProperty('thinkingLevel');
  });
});
