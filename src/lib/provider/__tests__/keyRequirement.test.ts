import { describe, expect, it } from 'vitest';
import { keyIsSatisfied, resolveRequiresKey } from '../keyRequirement';

describe('deciding whether a provider needs a key', () => {
  it('treats an endpoint the user set up as keyless', () => {
    // The rule this encodes: a self-built endpoint without a key is not a misconfiguration.
    expect(
      resolveRequiresKey({
        isUserAdded: true,
        catalog: true,
        strategy: 'openai-compatible',
        url: 'https://gateway.example.com/v1',
      }),
    ).toEqual({ requiresKey: false, source: 'user-added' });
  });

  it('still requires a key of a built-in hosted service', () => {
    expect(
      resolveRequiresKey({ catalog: true, strategy: 'openai', url: 'https://api.openai.com/v1' }),
    ).toEqual({ requiresKey: true, source: 'catalog' });
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
      resolveRequiresKey({ strategy: 'openai-compatible', url: 'http://localhost:1234/v1' })
        .requiresKey,
    ).toBe(false);
    expect(
      resolveRequiresKey({ strategy: 'openai-compatible', url: 'https://api.example.com/v1' })
        .requiresKey,
    ).toBe(true);
    expect(resolveRequiresKey({ strategy: 'ollama' }).requiresKey).toBe(false);
    expect(resolveRequiresKey({}).requiresKey).toBe(true);
  });

  it('treats a blank key as no key', () => {
    expect(keyIsSatisfied({ requiresKey: false, apiKey: null })).toBe(true);
    expect(keyIsSatisfied({ requiresKey: true, apiKey: '  ' })).toBe(false);
    expect(keyIsSatisfied({ requiresKey: true, apiKey: 'sk-1' })).toBe(true);
  });
});
