import { describe, expect, it } from 'vitest';
import { keyIsSatisfied, resolveRequiresKey } from '../keyRequirement';

describe('deciding whether a provider needs a key', () => {
  it('lets the stored choice win over the catalogue', () => {
    // A LAN gateway registered under a catalogue name is still the user's endpoint.
    expect(
      resolveRequiresKey({
        stored: false,
        catalog: true,
        strategy: 'openai-compatible',
      }).requiresKey,
    ).toBe(false);
    expect(
      resolveRequiresKey({ stored: true, catalog: false, strategy: 'ollama' })
        .requiresKey,
    ).toBe(true);
    expect(resolveRequiresKey({ stored: false, catalog: true }).source).toBe(
      'stored',
    );
  });

  it('lets a local endpoint outrank a catalogue built for a hosted service', () => {
    // The reported case: a self-hosted gateway filed under a "needs a key" default.
    expect(
      resolveRequiresKey({
        catalog: true,
        strategy: 'openai-compatible',
        url: 'http://10.126.126.2:8101/v1',
      }).requiresKey,
    ).toBe(false);
  });

  it('falls back to the catalogue when the user never chose', () => {
    expect(resolveRequiresKey({ catalog: false })).toEqual({
      requiresKey: false,
      source: 'catalog',
    });
  });

  it('defaults by strategy or by how local the endpoint is', () => {
    expect(resolveRequiresKey({ strategy: 'ollama' })).toEqual({
      requiresKey: false,
      source: 'strategy-default',
    });
    expect(resolveRequiresKey({ strategy: 'openai' }).requiresKey).toBe(true);
    expect(resolveRequiresKey({}).requiresKey).toBe(true);
    // The report that started this: a hand-added endpoint on the LAN.
    expect(
      resolveRequiresKey({
        strategy: 'openai-compatible',
        url: 'http://192.168.1.20:8000/v1',
      }).requiresKey,
    ).toBe(false);
    expect(
      resolveRequiresKey({
        strategy: 'openai-compatible',
        url: 'http://localhost:1234/v1',
      }).requiresKey,
    ).toBe(false);
    expect(
      resolveRequiresKey({
        strategy: 'openai-compatible',
        url: 'https://api.example.com/v1',
      }).requiresKey,
    ).toBe(true);
    expect(resolveRequiresKey({ url: 'http://[fe80::1]:11434' }).source).toBe(
      'strategy-default',
    );
  });

  it('treats a blank key as no key', () => {
    expect(keyIsSatisfied({ requiresKey: false, apiKey: null })).toBe(true);
    expect(keyIsSatisfied({ requiresKey: true, apiKey: '  ' })).toBe(false);
    expect(keyIsSatisfied({ requiresKey: true, apiKey: 'sk-1' })).toBe(true);
  });
});
