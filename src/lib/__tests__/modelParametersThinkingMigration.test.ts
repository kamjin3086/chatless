/**
 * Reading a model's parameters is the one place a persisted legacy `thinking` boolean can
 * turn into a level, so the wire and every screen agree on what it means (#100).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stored: Record<string, unknown> = {};

vi.mock('@/lib/storage', () => ({
  specializedStorage: {
    models: {
      getModelParameters: (provider: string, model: string) =>
        Promise.resolve(
          stored[`${provider}/${model}`] ?? stored.__default ?? null,
        ),
      setModelParameters: vi.fn(),
      removeModelParameters: vi.fn(),
    },
    sessions: {
      getParameters: vi.fn(() => Promise.resolve(null)),
      setParameters: vi.fn(),
      removeParameters: vi.fn(),
      listKeys: vi.fn(() => Promise.resolve([])),
    },
  },
}));

describe('reading stored parameters', () => {
  beforeEach(() => {
    for (const key of Object.keys(stored)) delete stored[key];
  });

  it('turns a stored "do not think" into the level that means it', async () => {
    // A stored bag in production arrives complete: it was written by the parameters
    // dialog, which saves the whole set.
    const { DEFAULT_MODEL_PARAMETERS } = await import('@/types/model-params');
    stored['openai/gpt-5.8'] = {
      ...DEFAULT_MODEL_PARAMETERS,
      enableThinking: true,
      thinking: false,
    };
    const { ModelParametersService } = await import('@/lib/model-parameters');
    const params = await ModelParametersService.getModelParameters(
      'openai',
      'gpt-5.8',
    );
    expect(params.enableThinkingLevel).toBe(true);
    expect(params.thinkingLevel).toBe('off');
    expect(params.thinking).toBeUndefined();
    expect(
      ModelParametersService.convertToChatOptions(params).thinkingLevel,
    ).toBe('off');
  });

  it('says nothing is stored, rather than handing back defaults that look like choices', async () => {
    // DEFAULT_MODEL_PARAMETERS carries `enableThinkingLevel: false`, meaning "refused",
    // so an unsaved model must not be reported as a refusal.
    const { ModelParametersService } = await import('@/lib/model-parameters');
    expect(
      await ModelParametersService.getRawModelParameters(
        'openai',
        'nobody-here',
      ),
    ).toBe(null);
  });

  it('hands back the raw bag when asked, so a hint can explain what changed', async () => {
    stored['openai/gpt-5.8'] = { enableThinking: true, thinking: true };
    const { ModelParametersService } = await import('@/lib/model-parameters');
    const raw = await ModelParametersService.getRawModelParameters(
      'openai',
      'gpt-5.8',
    );
    expect(raw.thinking).toBe(true);
    const migrated = await ModelParametersService.getModelParameters(
      'openai',
      'gpt-5.8',
    );
    expect(migrated.thinking).toBe(true); // kept, and now explained
  });
});
