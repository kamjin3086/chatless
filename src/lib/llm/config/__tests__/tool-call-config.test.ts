import { describe, expect, it } from 'vitest';
import { inferProviderId, getProviderConfig } from '@/lib/llm/config/tool-call-config';

describe('tool-call-config Lemonade', () => {
  it('infers lemonade provider id', () => {
    expect(inferProviderId('Lemonade')).toBe('lemonade');
    expect(inferProviderId('lemonade-server')).toBe('lemonade');
  });

  it('returns lemonade provider config', () => {
    const config = getProviderConfig('Lemonade');
    expect(config.id).toBe('lemonade');
    expect(config.defaultCapability).toBe('native');
    expect(config.streamingSupport).toBe(true);
  });
});
