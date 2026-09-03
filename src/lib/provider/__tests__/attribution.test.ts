import { describe, expect, it } from 'vitest';
import { APP_INFO } from '@/config/app-info';
import { AIHUBMIX_APP_CODE, getGatewayExtraHeaders } from '@/lib/provider/attribution';

describe('getGatewayExtraHeaders', () => {
  it('adds OpenRouter attribution headers', () => {
    const headers = getGatewayExtraHeaders('OpenRouter', 'https://openrouter.ai/api/v1');
    expect(headers['HTTP-Referer']).toBe(APP_INFO.repository);
    expect(headers['X-Title']).toBe(APP_INFO.name);
    expect(headers['X-OpenRouter-Title']).toBe(APP_INFO.name);
  });

  it('adds OrcaRouter attribution headers', () => {
    const headers = getGatewayExtraHeaders('OrcaRouter', 'https://api.orcarouter.ai/v1');
    expect(headers['HTTP-Referer']).toBe(APP_INFO.repository);
    expect(headers['X-Title']).toBe(APP_INFO.name);
    expect(headers['X-OpenRouter-Title']).toBeUndefined();
  });

  it('adds AIHubMix APP-Code', () => {
    const headers = getGatewayExtraHeaders('AIHubMix', 'https://api.aihubmix.com/v1');
    expect(headers['APP-Code']).toBe(AIHUBMIX_APP_CODE);
  });

  it('does not add extra headers for unrelated providers', () => {
    expect(getGatewayExtraHeaders('DeepSeek', 'https://api.deepseek.com')).toEqual({});
  });
});
