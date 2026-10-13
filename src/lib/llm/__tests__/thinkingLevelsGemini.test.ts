/**
 * Gemini is the provider where "how much does this think" has two different wire
 * shapes depending on which generation you are talking to, and the documentation is
 * explicit that they are not interchangeable: the 3 series takes `thinkingLevel`,
 * the 2.5 series "doesn't support thinkingLevel; use thinkingBudget instead", and a
 * level that a given model does not advertise is an error rather than a hint.
 *
 * The numbers here come from ai.google.dev/gemini-api/docs/generate-content/thinking
 * (last updated 2026-10-09): which levels each 3-series model supports, and the
 * `thinkingBudget` range and disable-ability of each 2.5 model.
 */
import { describe, expect, it } from 'vitest';
import { ParameterPolicyEngine } from '../ParameterPolicy';
import { supportedThinkingLevels, thinkingWireFor } from '../thinkingLevels';

const LEVEL_PATH = ['generationConfig', 'thinkingConfig', 'thinkingLevel'];
const BUDGET_PATH = ['generationConfig', 'thinkingConfig', 'thinkingBudget'];

function at(source: any, path: string[]): any {
  return path.reduce((acc, key) => (acc == null ? acc : acc[key]), source);
}

function has(source: any, path: string[]): boolean {
  return at(source, path.slice(0, -1))?.[path[path.length - 1]] !== undefined;
}

describe('Gemini 3 takes thinkingLevel', () => {
  it('writes the level at the nested path the API documents', () => {
    const out = ParameterPolicyEngine.apply('Google AI', 'gemini-3.8-flash', {
      thinkingLevel: 'low',
    });
    expect(at(out, LEVEL_PATH)).toBe('low');
    expect(out).not.toHaveProperty('thinkingLevel');
    // The two forms are mutually exclusive: a budget next to a level is a 400.
    expect(has(out, BUDGET_PATH)).toBe(false);
  });

  it('offers each model only the levels it advertises', () => {
    // `minimal` is documented as "Not supported (error)" on 3.8 Flash, and the
    // image variant only documents minimal and high.
    expect(supportedThinkingLevels('Google AI', 'gemini-3.8-flash')).toEqual([
      'low',
      'medium',
      'high',
    ]);
    expect(supportedThinkingLevels('Google AI', 'gemini-3.6-flash')).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
    ]);
    expect(
      supportedThinkingLevels('Google AI', 'gemini-3.1-flash-lite-image'),
    ).toEqual(['minimal', 'high']);
  });

  it('sends nothing for a level the model does not advertise', () => {
    // Quietly downgrading `minimal` to `low` would be a guess about what the user
    // meant, and the server would have told us so itself.
    const out = ParameterPolicyEngine.apply('Google AI', 'gemini-3.8-flash', {
      thinkingLevel: 'minimal',
    });
    expect(has(out, LEVEL_PATH)).toBe(false);
    expect(has(out, BUDGET_PATH)).toBe(false);
  });

  it('does not offer off to models that cannot stop thinking', () => {
    // "You cannot disable thinking for Gemini 3.1 Pro"; nothing here pretends otherwise.
    expect(supportedThinkingLevels('Google AI', 'gemini-3.1-pro')).toEqual([
      'low',
      'medium',
      'high',
    ]);
    for (const model of ['gemini-3.1-pro', 'gemini-3-flash']) {
      const out = ParameterPolicyEngine.apply('Google AI', model, {
        thinkingLevel: 'off',
      });
      expect(has(out, LEVEL_PATH)).toBe(false);
      expect(has(out, BUDGET_PATH)).toBe(false);
    }
  });
});

describe('Gemini 2.5 takes thinkingBudget', () => {
  it('maps a level onto a budget inside the documented range', () => {
    const out = ParameterPolicyEngine.apply('Google AI', 'gemini-2.5-flash', {
      thinkingLevel: 'medium',
    });
    expect(at(out, BUDGET_PATH)).toBe(8192);
    expect(has(out, LEVEL_PATH)).toBe(false);
  });

  it('means zero when the level is off, rather than omitting the field', () => {
    // Documented: thinkingBudget 0 disables thinking on 2.5 Flash. Omitting the field
    // instead would leave the model in dynamic thinking, which is the opposite answer.
    const out = ParameterPolicyEngine.apply('Google AI', 'gemini-2.5-flash', {
      thinkingLevel: 'off',
    });
    expect(at(out, BUDGET_PATH)).toBe(0);
    expect(has(out, LEVEL_PATH)).toBe(false);
  });

  it('keeps off out of reach for 2.5 Pro, which cannot disable thinking', () => {
    expect(supportedThinkingLevels('Google AI', 'gemini-2.5-pro')).toEqual([
      'low',
      'medium',
      'high',
    ]);
    const out = ParameterPolicyEngine.apply('Google AI', 'gemini-2.5-pro', {
      thinkingLevel: 'off',
    });
    expect(has(out, BUDGET_PATH)).toBe(false);
  });

  it('stays inside the smaller floor of Flash Lite', () => {
    // Flash Lite documents 512..24576, so every offered budget has to be >= 512.
    const levels = supportedThinkingLevels(
      'Google AI',
      'gemini-2.5-flash-lite',
    );
    expect(levels).toContain('low');
    for (const level of levels) {
      const wire = thinkingWireFor(
        'Google AI',
        'gemini-2.5-flash-lite',
        level as any,
      );
      if (level !== 'off')
        expect(Number(wire?.value)).toBeGreaterThanOrEqual(512);
    }
  });

  it('is scoped to the provider, not to the model name', () => {
    // A gateway that happens to serve a model called `gemini-2.5-flash` does not get to
    // speak Gemini's nested dialect; that is how a field reaches a server that never
    // advertised one.
    expect(
      supportedThinkingLevels('OpenAI Compatible', 'gemini-2.5-flash'),
    ).toEqual([]);
    const out = ParameterPolicyEngine.apply(
      'OpenAI Compatible',
      'gemini-2.5-flash',
      {
        thinkingLevel: 'low',
      },
    );
    expect(out).not.toHaveProperty('generationConfig');
    expect(out).not.toHaveProperty('thinkingLevel');
  });

  it("does not write through to the caller's option object", () => {
    // The option bag is shared with stored model parameters and with the UI, so a rule
    // that reached through it would leave a level applied to requests the user never
    // chose a level for.
    const base: Record<string, any> = {
      generationConfig: { temperature: 0.1 },
    };
    const out = ParameterPolicyEngine.apply('Google AI', 'gemini-2.5-flash', {
      ...base,
      thinkingLevel: 'medium',
    });
    expect(out.generationConfig.thinkingConfig.thinkingBudget).toBe(8192);
    expect(base.generationConfig.thinkingConfig).toBeUndefined();
    expect(base.generationConfig.temperature).toBe(0.1);
  });

  it('lets a value the user wrote beat the mapped one', () => {
    const out = ParameterPolicyEngine.apply('Google AI', 'gemini-2.5-flash', {
      thinkingLevel: 'high',
      generationConfig: { thinkingConfig: { thinkingBudget: 4321 } },
    });
    expect(at(out, BUDGET_PATH)).toBe(4321);
  });
});

describe('the injected default budget is gone', () => {
  it('sends no thinking config at all when the user chose no level', () => {
    // The old rule pinned generationConfig.thinkingConfig.thinkingBudget to 1024 for
    // anything matching *-thinking*, which both competed with a user's level and was
    // a number nobody had chosen. Leaving the field unset is the documented way to get
    // the model's own dynamic thinking.
    for (const model of [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-pro-preview-06-05',
      'gemini-1.5-pro-thinking',
      'gemini-2.0-flash-thinking',
    ]) {
      const out = ParameterPolicyEngine.apply('Google AI', model, {});
      expect([model, at(out, BUDGET_PATH)]).toEqual([model, undefined]);
    }
  });

  it('still normalises the unrelated generationConfig fields it was also doing', () => {
    const out = ParameterPolicyEngine.apply('Google AI', 'gemini-2.5-pro', {
      maxTokens: 256,
      stop: ['###'],
    });
    expect(out.generationConfig.maxOutputTokens).toBe(256);
    expect(out.generationConfig.stopSequences).toEqual(['###']);
  });
});

describe('a Gemini that supports neither form', () => {
  it('is reported as unsupported and sent nothing', () => {
    for (const model of ['gemini-1.5-pro', 'gemini-2.0-flash', 'gemini-pro']) {
      expect(supportedThinkingLevels('Google AI', model)).toEqual([]);
      const out = ParameterPolicyEngine.apply('Google AI', model, {
        thinkingLevel: 'medium',
      });
      expect(has(out, LEVEL_PATH)).toBe(false);
      expect(has(out, BUDGET_PATH)).toBe(false);
      expect(out).not.toHaveProperty('thinkingLevel');
    }
  });
});
