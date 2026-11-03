import { describe, expect, it } from 'vitest';
import {
  getProviderCredentials,
  isMissingRequiredCredentials,
  isProviderConfigured,
  providerLabel,
} from '../registry';
import { buildSearchRequest } from '../request';
import type { WebSearchConfig } from '@/store/webSearchStore';

describe('keenable provider', () => {
  it('is usable without an API key', () => {
    expect(providerLabel('keenable')).toBe('Keenable');
    expect(isProviderConfigured('keenable', {})).toBe(true);
    expect(isMissingRequiredCredentials('keenable', {})).toBe(false);
    expect(getProviderCredentials('keenable', {})).toEqual({ apiKey: undefined });
  });

  it('passes the optional key and result count', () => {
    expect(getProviderCredentials('keenable', { apiKeyKeenable: 'k' })).toEqual({ apiKey: 'k' });
    const cfg = { keenableMaxResults: 7 } as WebSearchConfig;
    expect(buildSearchRequest(cfg, 'keenable', 'q', 'k')).toMatchObject({
      provider: 'keenable', query: 'q', apiKey: 'k', maxResults: 7,
    });
  });
});
