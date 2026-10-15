import { describe, expect, it } from 'vitest';
import { ModelParametersService } from '@/lib/model-parameters';
import { DEFAULT_MODEL_PARAMETERS } from '@/types/model-params';
import { applyThinkingChoice } from '@/lib/chat/thinkingScope';
import type { ModelParameters } from '@/types/model-params';

/**
 * `convertToChatOptions` is typed as if it always receives a complete `ModelParameters`,
 * and the send path hands it a session bag - a `Partial<ModelParameters>` with a cast on
 * top of it. Anything a stored session never wrote is simply absent there, and one field was
 * read as `parameters.stopSequences.length` before asking whether it existed, so choosing a
 * thinking level in a chat that had no session bag before threw
 * `undefined is not an object (evaluating 'parameters.stopSequences.length')` on every send.
 */
describe('stop sequences with a partial parameter bag', () => {
  it('says nothing about stop sequences when the bag never had them', () => {
    const partial: Partial<ModelParameters> = { ...DEFAULT_MODEL_PARAMETERS };
    delete partial.stopSequences;
    delete partial.enableStopSequences;
    expect(() =>
      ModelParametersService.convertToChatOptions(partial as ModelParameters),
    ).not.toThrow();
    expect(
      ModelParametersService.convertToChatOptions(partial as ModelParameters),
    ).not.toHaveProperty('stop');
  });

  it('treats a stored null the same way instead of dereferencing it', () => {
    const bag = {
      ...DEFAULT_MODEL_PARAMETERS,
      stopSequences: null as unknown as string[],
    };
    expect(() =>
      ModelParametersService.convertToChatOptions(bag),
    ).not.toThrow();
    expect(ModelParametersService.convertToChatOptions(bag)).not.toHaveProperty(
      'stop',
    );
  });

  it('survives the bag the level switch actually writes for a fresh conversation', () => {
    // The reported sequence: nothing had been saved for this conversation, the user picks a
    // level, and the resulting session bag - which knows nothing about stop sequences - is
    // what the next send converts.
    const next = applyThinkingChoice({
      modelParams: { ...DEFAULT_MODEL_PARAMETERS },
      conversationParams: null,
      messageParams: null,
      scope: 'conversation',
      level: 'medium',
    });
    const bag = next.conversationParams as ModelParameters;
    expect(bag.stopSequences).toBeUndefined();
    const opts = ModelParametersService.convertToChatOptions(bag);
    expect(opts.thinkingLevel).toBe('medium');
    expect(opts).not.toHaveProperty('stop');
  });

  it('still sends real stop sequences when a bag carries them', () => {
    const bag: ModelParameters = {
      ...DEFAULT_MODEL_PARAMETERS,
      enableStopSequences: true,
      stopSequences: ['###', 'END'],
    };
    expect(ModelParametersService.convertToChatOptions(bag).stop).toEqual([
      '###',
      'END',
    ]);
  });

  it('keeps an explicit "off" explicit', () => {
    const bag: ModelParameters = {
      ...DEFAULT_MODEL_PARAMETERS,
      enableStopSequences: false,
      stopSequences: ['###'],
    };
    expect(ModelParametersService.convertToChatOptions(bag)).not.toHaveProperty(
      'stop',
    );
  });
});
