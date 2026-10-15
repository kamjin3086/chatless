import {
  ModelParametersService,
  sanitizeParameterPatch,
} from '@/lib/model-parameters';
import { DEFAULT_MODEL_PARAMETERS } from '@/types/model-params';
import { describe, expect, it } from 'vitest';

/**
 * Two jobs, deliberately kept apart.
 *
 * One job: drop what cannot be trusted, keep what is absent absent.
 *
 * The first version of this helper filled defaults on the way out of storage. A test that
 * predates it proved that wrong - a retired boolean is *deleted* by a migration so no screen
 * can read a stale flag, and `DEFAULT_MODEL_PARAMETERS` carries `enableThinkingLevel: false`
 * meaning "this bag refused a level" - so completeness on read would have erased meaning
 * this codebase stores in absence. What storage cleaning means here is typing and range:
 * a stored `"0.7"`, a `null` array or a temperature of 99 stops at this boundary, which is
 * what let one of those shapes reach a user as a crash (#137).
 */
describe('sanitizeParameterPatch', () => {
  it('keeps absence as absence instead of completing the bag', () => {
    const patch = sanitizeParameterPatch({
      thinkingLevel: 'medium',
      enableThinkingLevel: true,
      temperature: 'x',
      stopSequences: null,
      advancedOptions: 'nope',
    });
    expect(patch).toEqual({
      thinkingLevel: 'medium',
      enableThinkingLevel: true,
    });
    expect('temperature' in patch).toBe(false);
    expect('stopSequences' in patch).toBe(false);
    expect('advancedOptions' in patch).toBe(false);
  });

  it('turns nothing at all into an empty patch', () => {
    expect(sanitizeParameterPatch(undefined)).toEqual({});
    expect(sanitizeParameterPatch('nope')).toEqual({});
    expect(sanitizeParameterPatch([1, 2])).toEqual({});
  });

  it('leaves a real override exactly as written', () => {
    expect(
      sanitizeParameterPatch({
        enableTemperature: true,
        temperature: 0.2,
        stopSequences: ['<|im_end|>'],
      }),
    ).toEqual({
      enableTemperature: true,
      temperature: 0.2,
      stopSequences: ['<|im_end|>'],
    });
  });
});

describe('convertToChatOptions takes a patch, not a promise of completeness', () => {
  it('sends the level a session chose and nothing it did not choose', () => {
    const opts = ModelParametersService.convertToChatOptions({
      enableThinkingLevel: true,
      thinkingLevel: 'low',
    });
    expect(opts.thinkingLevel).toBe('low');
    // Asserted on the wire, not on the intermediate object: the builder may carry a key as
    // `undefined`, and what a server sees is the serialized form.
    const wire = JSON.parse(JSON.stringify(opts));
    expect(wire).not.toHaveProperty('temperature');
    expect(wire).not.toHaveProperty('stop');
  });

  it('drops a stored value whose type is wrong instead of forwarding it', () => {
    const opts = ModelParametersService.convertToChatOptions({
      enableTemperature: true,
      temperature: '0.9' as unknown as number,
      stopSequences: '<|im_end|>' as unknown as string[],
    });
    const wire = JSON.parse(JSON.stringify(opts));
    expect(wire).not.toHaveProperty('temperature');
    expect(wire).not.toHaveProperty('stop');
  });
});
