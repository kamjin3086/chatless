import { describe, expect, it } from 'vitest';
import { translate } from '@/i18n';
import type { TranslationKey } from '@/i18n/types';
import { ParameterPolicyEngine } from '../ParameterPolicy';
import type { ThinkingLevel } from '../thinkingLevels';
import {
  THINKING_LEVEL_ORDER,
  findThinkingMapping,
  resolveThinkingModelName,
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
    // gateway: it must not borrow that gateway's effort field, and what it does offer is
    // its own carrier (off), not a guessed tier list.
    expect(supportedThinkingLevels('Ollama', 'deepseek-r1:32b')).toEqual([
      'off',
    ]);
    expect(thinkingWireFor('Ollama', 'deepseek-r1:32b', 'medium')).toBeNull();
    expect(findThinkingMapping('Ollama', 'deepseek-r1:32b')?.id).toBe(
      'ollama-think',
    );
    // and the rule sends nothing at all for a level Ollama was not promised
    const out = ParameterPolicyEngine.apply('Ollama', 'deepseek-r1:32b', {
      thinkingLevel: 'medium',
    });
    expect(out).not.toHaveProperty('reasoning_effort');
    expect(out).not.toHaveProperty('thinkingLevel');
    expect(out).not.toHaveProperty('thinking');
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
      overrides: false,
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

  it('does not disturb unrelated Gemini generation fields', () => {
    const out = ParameterPolicyEngine.apply('Google AI', 'gemini-2.5-pro', {
      generationConfig: { temperature: 0.3 },
      thinkingLevel: 'medium',
    });
    expect(out.generationConfig.temperature).toBe(0.3);
    expect(out.generationConfig.thinkingConfig.thinkingBudget).toBe(8192);
  });
  it('expresses off on Ollama as think:false rather than omitting the field', () => {
    // Ollama's API takes true/false/null and nothing graded unless /api/show names it,
    // so the only level this repo claims for Ollama is "do not think". The generic
    // `thinking` option is what the Ollama provider already turns into the body field.
    const out = ParameterPolicyEngine.apply('Ollama', 'qwen3:32b', {
      thinkingLevel: 'off',
    });
    expect(out.thinking).toBe(false);
    expect(out).not.toHaveProperty('thinkingLevel');
    expect(out).not.toHaveProperty('reasoning_effort');
    expect(supportedThinkingLevels('Ollama', 'qwen3:32b')).toEqual(['off']);
  });

  it('lets the level override the older boolean on Ollama', () => {
    // The boolean says "think", the level says "do not", and the level is the newer,
    // more specific statement. Silently keeping the boolean would be the failure.
    const out = ParameterPolicyEngine.apply('Ollama', 'qwen3:32b', {
      thinking: true,
      thinkingLevel: 'off',
    });
    expect(out.thinking).toBe(false);
  });

  it('never puts a tier-in-the-name template on the wire', () => {
    const out = ParameterPolicyEngine.apply(
      'OpenAI Compatible',
      'some-reasoner',
      {
        thinkingModelSuffixes: { off: '-instruct' },
      },
    );
    expect(out).not.toHaveProperty('thinkingModelSuffixes');
    expect(out).not.toHaveProperty('reasoning_effort');
  });
});

describe('tier-baked-into-the-name routers', () => {
  const suffixes = {
    off: '-instruct',
    low: '_llamacpp-low',
    medium: '_llamacpp-medium',
    xhigh: '_llamacpp-xhigh',
  };

  it('leaves the model alone when no template or no level is in play', () => {
    expect(resolveThinkingModelName({ model: 'Qwen3.8-Flash-Next' })).toBe(
      'Qwen3.8-Flash-Next',
    );
    expect(
      resolveThinkingModelName({ model: 'X', level: 'auto', suffixes }),
    ).toBe('X');
    expect(
      resolveThinkingModelName({ model: 'X', level: 'low', suffixes: {} }),
    ).toBe('X');
  });

  it('picks the sibling model the level names', () => {
    expect(
      resolveThinkingModelName({
        model: 'Qwen3.8-Flash-Next',
        level: 'off',
        suffixes,
      }),
    ).toBe('Qwen3.8-Flash-Next-instruct');
    expect(
      resolveThinkingModelName({
        model: 'Qwen3.8-Flash-Next_llamacpp',
        level: 'medium',
        suffixes,
      }),
    ).toBe('Qwen3.8-Flash-Next_llamacpp_llamacpp-medium');
  });

  it('refuses to invent a model name for a level with no sibling', () => {
    // Sending a guessed name means a confusing router 404 at generation time; failing
    // at request build time names the level and the model instead.
    expect(() =>
      resolveThinkingModelName({
        model: 'Qwen3.8-Flash-Next',
        level: 'minimal',
        suffixes,
      }),
    ).toThrow(/minimal/);
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
