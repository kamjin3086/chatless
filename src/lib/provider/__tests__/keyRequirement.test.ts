import { describe, expect, it } from 'vitest';
import { keyIsSatisfied, resolveRequiresKey } from '../keyRequirement';

describe('deciding whether a provider needs a key', () => {
  it('still requires a key of a hosted service the user switched on', () => {
    // Enabling Azure/OpenRouter/Groq from the catalogue sets isUserAdded: true, so
    // "the user added it" cannot be the test for "this is the user's own endpoint".
    for (const name of ['Azure OpenAI', 'OpenRouter', 'Groq', 'New API']) {
      expect(
        resolveRequiresKey({
          catalog: true,
          strategy: 'openai-compatible',
          url: 'https://gateway.example.com/v1',
        }),
        name,
      ).toEqual({ requiresKey: true, source: 'catalog' });
    }
  });

  it('treats an endpoint that is not in the catalogue as the user own', () => {
    // No catalogue entry means nobody told us about this service, so no key filled in
    // is the configuration rather than a mistake.
    expect(
      resolveRequiresKey({
        strategy: 'openai-compatible',
        url: 'https://gw.example.com/v1',
      }),
    ).toEqual({ requiresKey: false, source: 'custom' });
  });

  it('reads a local address as needing no credential', () => {
    // A self-hosted gateway filed under a hosted catalogue default is the reported case.
    expect(
      resolveRequiresKey({
        catalog: true,
        strategy: 'openai-compatible',
        url: 'http://10.126.126.2:8101/v1',
      }),
    ).toEqual({ requiresKey: false, source: 'local' });
    expect(
      resolveRequiresKey({
        strategy: 'openai-compatible',
        url: 'http://localhost:1234/v1',
      }).requiresKey,
    ).toBe(false);
    expect(
      resolveRequiresKey({
        catalog: true,
        strategy: 'openai-compatible',
        url: 'http://localhost:1234/v1',
      }).source,
    ).toBe('local');
    // Ollama answers keyless even where only the strategy says so.
    expect(
      resolveRequiresKey({
        catalog: true,
        strategy: 'ollama',
        url: 'https://remote.example.com',
      }),
    ).toEqual({ requiresKey: false, source: 'local' });
  });

  it('treats a blank key as no key', () => {
    expect(keyIsSatisfied({ requiresKey: false, apiKey: null })).toBe(true);
    expect(keyIsSatisfied({ requiresKey: true, apiKey: '  ' })).toBe(false);
    expect(keyIsSatisfied({ requiresKey: true, apiKey: 'sk-1' })).toBe(true);
  });
});
