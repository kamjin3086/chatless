import { describe, expect, it } from 'vitest';
import { AVAILABLE_PROVIDERS_CATALOG } from '@/lib/provider/catalog';

describe('AVAILABLE_PROVIDERS_CATALOG', () => {
  it('includes Lemonade with correct defaults', () => {
    const lemonade = AVAILABLE_PROVIDERS_CATALOG.find((p) => p.id === 'lemonade');
    expect(lemonade).toBeDefined();
    expect(lemonade?.name).toBe('Lemonade');
    expect(lemonade?.strategy).toBe('openai-compatible');
    expect(lemonade?.requiresKey).toBe(false);
    expect(lemonade?.defaultUrl).toBe('http://localhost:13305/api/v1');
  });

  it('has unique provider ids', () => {
    const ids = AVAILABLE_PROVIDERS_CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes MixRoute as an OpenAI-compatible aggregator', () => {
    const mixroute = AVAILABLE_PROVIDERS_CATALOG.find((p) => p.id === 'mixroute');
    expect(mixroute).toBeDefined();
    expect(mixroute?.name).toBe('MixRoute');
    expect(mixroute?.strategy).toBe('openai-compatible');
    expect(mixroute?.requiresKey).toBe(true);
    expect(mixroute?.defaultUrl).toBe('https://api.mixroute.ai/v1');
  });

  it('includes Novita as an OpenAI-compatible aggregator', () => {
    const novita = AVAILABLE_PROVIDERS_CATALOG.find((p) => p.id === 'novita');
    expect(novita).toBeDefined();
    expect(novita?.name).toBe('Novita');
    expect(novita?.strategy).toBe('openai-compatible');
    expect(novita?.requiresKey).toBe(true);
    expect(novita?.defaultUrl).toBe('https://api.novita.ai/openai/v1');
  });
});
