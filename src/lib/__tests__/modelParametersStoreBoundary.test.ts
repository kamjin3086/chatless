/**
 * The store is where a parameter bag stops being JSON and starts being `ModelParameters`,
 * so it is the one place allowed to decide what a trustworthy value is. Review of #138 found
 * the claim made louder than the code: two readers still handed raw storage upward, so a
 * hand-edited `"0.9"` reached a screen while the wire silently dropped it - the exact split
 * this subsystem keeps being careful about.
 *
 * Cleaning means typing and range, never completion: absence is how `auto`, "this scope has
 * no opinion" and "nothing stored" are represented.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stored: Record<string, unknown> = {};

vi.mock('@/lib/storage', () => ({
  specializedStorage: {
    models: {
      getModelParameters: (provider: string, model: string) =>
        Promise.resolve(stored[`model:${provider}/${model}`] ?? null),
      setModelParameters: vi.fn(),
      removeModelParameters: vi.fn(),
      getSessionParameters: (conversationId: string) =>
        Promise.resolve(stored[`session:${conversationId}`] ?? null),
    },
    sessions: {
      getParameters: vi.fn(() => Promise.resolve(null)),
      setParameters: vi.fn(),
      removeParameters: vi.fn(),
      listKeys: vi.fn(() => Promise.resolve([])),
    },
  },
}));

describe('what a stored bag arrives as', () => {
  beforeEach(() => {
    for (const key of Object.keys(stored)) delete stored[key];
  });

  it('passes a bag the dialog wrote through untouched', async () => {
    const { DEFAULT_MODEL_PARAMETERS } = await import('@/types/model-params');
    const written = { ...DEFAULT_MODEL_PARAMETERS, temperature: 0.3 };
    stored['model:openai/gpt-5.8'] = written;
    const { ModelParametersService } = await import('@/lib/model-parameters');
    expect(
      await ModelParametersService.getModelParameters('openai', 'gpt-5.8'),
    ).toEqual(written);
  });

  it('does not let a wrong type through from a model bag', async () => {
    stored['model:openai/gpt-5.8'] = {
      enableTemperature: true,
      temperature: '0.9',
      stopSequences: '###',
      thinkingLevel: 'very-high',
    };
    const { ModelParametersService } = await import('@/lib/model-parameters');
    const params = await ModelParametersService.getModelParameters(
      'openai',
      'gpt-5.8',
    );
    expect('temperature' in params).toBe(false);
    expect('stopSequences' in params).toBe(false);
    expect('thinkingLevel' in params).toBe(false);
  });

  it('does not let a wrong type through from a session bag either', async () => {
    // This reader is the one a conversation's parameters come through, and a session bag is
    // read by the dialog as well as by a send.
    stored['session:conv-1'] = {
      enableThinkingLevel: true,
      thinkingLevel: 'medium',
      enableTemperature: 'yes',
      temperature: 0.2,
      advancedOptions: 'nope',
    };
    const { ModelParametersService } = await import('@/lib/model-parameters');
    const params = await ModelParametersService.getSessionParameters('conv-1');
    expect(params).toEqual({
      enableThinkingLevel: true,
      thinkingLevel: 'medium',
      temperature: 0.2,
    });
  });

  it('keeps saying nothing was stored, rather than a cleaned empty bag', async () => {
    // Null is a real answer here: a screen that was told "nothing stored" must not be shown
    // a default that looks like a choice the user made.
    const { ModelParametersService } = await import('@/lib/model-parameters');
    expect(
      await ModelParametersService.getSessionParameters('empty'),
    ).toBeNull();
    expect(
      await ModelParametersService.getRawModelParameters('x', 'y'),
    ).toBeNull();
  });
});

describe('the shape table covers the whole type', () => {
  it('has a row for every field the defaults carry', async () => {
    // `PARAM_FIELDS` is typed to cover every key of `ModelParameters`, so this is enforced
    // at compile time too; this test is the version that fails with a readable message.
    const { DEFAULT_MODEL_PARAMETERS } = await import('@/types/model-params');
    const { sanitizeParameterPatch } = await import('@/lib/model-parameters');
    const clean = sanitizeParameterPatch({ ...DEFAULT_MODEL_PARAMETERS });
    const dropped = Object.keys(DEFAULT_MODEL_PARAMETERS)
      .filter(
        (key) =>
          DEFAULT_MODEL_PARAMETERS[
            key as keyof typeof DEFAULT_MODEL_PARAMETERS
          ] !== undefined,
      )
      .filter((key) => !(key in clean));
    expect(dropped).toEqual([]);
  });
});

describe('the bag a screen reads', () => {
  it('is the cleaned bag, not the stored JSON', async () => {
    // #144: the dialog read storage directly, so a hand-edited `"0.9"` sat on the slider
    // while the send path dropped the same value. One read, one meaning.
    stored['model:openai/gpt-5.8'] = {
      enableTemperature: true,
      temperature: '0.9',
      topP: 0.7,
      thinking: false,
    };
    const { ModelParametersService } = await import('@/lib/model-parameters');

    // The screen sees what the wire sees, down to the retired boolean's translation.
    expect(
      await ModelParametersService.getModelParametersOrNull(
        'openai',
        'gpt-5.8',
      ),
    ).toEqual({
      enableTemperature: true,
      topP: 0.7,
      enableThinkingLevel: true,
      thinkingLevel: 'off',
    });
  });

  it('still says nothing was stored, where the complete bag would say "defaults"', async () => {
    // The dialog needs the difference to decide whether the user changed anything;
    // `getModelParameters` keeps answering with a complete bag for callers that want one.
    const { DEFAULT_MODEL_PARAMETERS } = await import('@/types/model-params');
    const { ModelParametersService } = await import('@/lib/model-parameters');

    expect(
      await ModelParametersService.getModelParametersOrNull(
        'openai',
        'nothing',
      ),
    ).toBeNull();
    expect(
      await ModelParametersService.getModelParameters('openai', 'nothing'),
    ).toEqual(DEFAULT_MODEL_PARAMETERS);
  });

  it('agrees with the complete bag whenever something was stored', async () => {
    // Two readers, one meaning: absence is the only thing that may differ between them.
    stored['model:anthropic/claude-sonnet-5'] = {
      temperature: 0.2,
      maxTokens: 4096,
      stopSequences: '###',
      advancedOptions: { reasoning_effort: 'high' },
    };
    const { ModelParametersService } = await import('@/lib/model-parameters');

    const orNull = await ModelParametersService.getModelParametersOrNull(
      'anthropic',
      'claude-sonnet-5',
    );
    expect(orNull).toEqual(
      await ModelParametersService.getModelParameters(
        'anthropic',
        'claude-sonnet-5',
      ),
    );
    expect(orNull).toEqual({
      temperature: 0.2,
      maxTokens: 4096,
      advancedOptions: { reasoning_effort: 'high' },
    });
  });
});

describe('the raw reader stays raw', () => {
  it('hands back the bag as written, because a migration hint is about that bag', async () => {
    // The service reader above drops what it cannot trust. This one must not: the control
    // that explains a migration would otherwise describe a value the store never held.
    const { ModelParametersService } = await import('@/lib/model-parameters');
    stored['model:deepseek/deepseek-chat'] = { thinking: false, topK: '8' };
    expect(
      await ModelParametersService.getRawModelParameters(
        'deepseek',
        'deepseek-chat',
      ),
    ).toEqual({
      thinking: false,
      topK: '8',
    });
    expect(
      await ModelParametersService.getModelParameters(
        'deepseek',
        'deepseek-chat',
      ),
    ).toEqual({ thinking: false });
  });
});
