import { describe, expect, it } from 'vitest';
import { ModelParametersService } from '@/lib/model-parameters';
import { DEFAULT_MODEL_PARAMETERS } from '@/types/model-params';
import type { ModelParameters } from '@/types/model-params';

/**
 * The request carries a parameter only when the user chose it: a model bag that never
 * touched a switch sends nothing, and a chosen value is sent under its generic name even
 * when it equals the default. A value left in the bag without a switch is the stored
 * default, not a choice - the old `value !== default` rule sent those, which is how a
 * stop list nobody set could reach the wire.
 */
const PARAMETER_KEYS = [
  'temperature',
  'maxTokens',
  'topP',
  'topK',
  'minP',
  'frequencyPenalty',
  'presencePenalty',
  'stop',
  'thinking',
  'thinkingLevel',
  'format',
] as const;

function chosen(options: Record<string, any>): Record<string, any> {
  const picked: Record<string, any> = {};
  for (const key of PARAMETER_KEYS) {
    if (options[key] !== undefined) picked[key] = options[key];
  }
  return picked;
}

const model = (patch: Partial<ModelParameters>): ModelParameters => ({
  ...DEFAULT_MODEL_PARAMETERS,
  ...patch,
});

describe('a model bag sends what its switches chose, and nothing else', () => {
  it('sends no parameter for a bag that never touched a switch', () => {
    expect(
      chosen(
        ModelParametersService.convertToChatOptions(DEFAULT_MODEL_PARAMETERS),
      ),
    ).toEqual({});
  });

  it('sends a chosen value even when it equals the default', () => {
    const opts = ModelParametersService.convertToChatOptions(
      model({ enableTemperature: true, temperature: 0.7 }),
    );
    expect(opts.temperature).toBe(0.7);
  });

  it('does not send a stored default with no switch', () => {
    expect(
      chosen(
        ModelParametersService.convertToChatOptions(
          model({ temperature: 0.7 }),
        ),
      ),
    ).toEqual({});
  });

  it('does not send a value whose switch is explicitly off', () => {
    expect(
      chosen(
        ModelParametersService.convertToChatOptions(
          model({ enableTemperature: false, temperature: 0.2 }),
        ),
      ),
    ).toEqual({});
  });

  it('treats maxTokens the same way: no switch means automatic, not a value', () => {
    expect(
      chosen(
        ModelParametersService.convertToChatOptions(
          model({ enableMaxTokens: undefined, maxTokens: 1024 }),
        ),
      ),
    ).toEqual({});
    expect(
      ModelParametersService.convertToChatOptions(
        model({ enableMaxTokens: true, maxTokens: 1024 }),
      ).maxTokens,
    ).toBe(1024);
  });

  it('never sends stop sequences nobody set', () => {
    const cases = [
      model({}),
      model({ stopSequences: ['END'] }),
      model({ enableStopSequences: false, stopSequences: ['END'] }),
      model({ enableStopSequences: true, stopSequences: [] }),
    ];
    for (const bag of cases) {
      expect(
        ModelParametersService.convertToChatOptions(bag),
        JSON.stringify(bag),
      ).not.toHaveProperty('stop');
    }
    expect(
      ModelParametersService.convertToChatOptions(
        model({ enableStopSequences: true, stopSequences: ['END'] }),
      ).stop,
    ).toEqual(['END']);
  });

  it('sends format only when the format switch chose a non-empty value', () => {
    expect(
      ModelParametersService.convertToChatOptions(
        model({ enableFormat: true, format: 'json' }),
      ).format,
    ).toBe('json');
    for (const bag of [
      model({ format: 'json' }),
      model({ enableFormat: false, format: 'json' }),
      model({ enableFormat: true, format: undefined }),
      model({ enableFormat: true, format: 'none' }),
    ]) {
      expect(
        ModelParametersService.convertToChatOptions(bag),
        JSON.stringify(bag),
      ).not.toHaveProperty('format');
    }
  });

  it('passes advancedOptions through, because those are explicit user fields', () => {
    expect(
      ModelParametersService.convertToChatOptions(
        model({ advancedOptions: { reasoning_effort: 'high' } }),
      ).reasoning_effort,
    ).toBe('high');
  });
});

describe('a session patch says only what the conversation chose', () => {
  const convert = (patch: Partial<ModelParameters>) =>
    ModelParametersService.convertToChatOptions(patch, 'session');

  it('sends a present value without a switch when it differs from the default', () => {
    expect(convert({ temperature: 0.2 }).temperature).toBe(0.2);
    expect(convert({ maxTokens: 1024 }).maxTokens).toBe(1024);
    expect(convert({ stopSequences: ['END'] }).stop).toEqual(['END']);
  });

  it('still suppresses a stored default that nobody chose', () => {
    // The session dialog can hand the model/default bag through untouched; equality with
    // the default is the only signal that this value was not a session opinion.
    expect(chosen(convert({ temperature: 0.7 }))).toEqual({});
    expect(
      chosen(convert({ maxTokens: DEFAULT_MODEL_PARAMETERS.maxTokens })),
    ).toEqual({});
    expect(chosen(convert({ stopSequences: [] }))).toEqual({});
  });

  it('keeps an explicit off explicit', () => {
    expect(
      chosen(convert({ enableTemperature: false, temperature: 0.2 })),
    ).toEqual({});
    expect(
      chosen(convert({ enableStopSequences: false, stopSequences: ['END'] })),
    ).toEqual({});
  });

  it('sends a format the conversation picked', () => {
    expect(convert({ format: 'json' }).format).toBe('json');
    expect(convert({ enableFormat: false, format: 'json' })).not.toHaveProperty(
      'format',
    );
  });
});
