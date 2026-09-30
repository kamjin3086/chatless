import { APP_INFO } from '@/config/app-info';

/** AIHubMix 开源应用标识码：用户经 chatless 调用可享折扣（Claude 系列除外） */
export const AIHUBMIX_APP_CODE = 'VIKU2713';

function matches(name: string, url: string, id: string, host: RegExp): boolean {
  return name === id || name.includes(id) || host.test(url);
}

/**
 * OpenAI 兼容请求上的平台归因 / 优惠 header。
 * 仅按 Provider 名称或默认网关域名附加，不影响其它兼容接口。
 */
export function getGatewayExtraHeaders(providerName: string, baseUrl?: string): Record<string, string> {
  const name = (providerName || '').trim().toLowerCase();
  const url = baseUrl || '';
  const headers: Record<string, string> = {};

  if (matches(name, url, 'orcarouter', /orcarouter\.ai/i) || matches(name, url, 'openrouter', /openrouter\.ai/i)) {
    headers['HTTP-Referer'] = APP_INFO.repository;
    headers['X-Title'] = APP_INFO.name;
  }
  if (matches(name, url, 'openrouter', /openrouter\.ai/i)) {
    headers['X-OpenRouter-Title'] = APP_INFO.name;
  }
  if (matches(name, url, 'aihubmix', /aihubmix\.com/i)) {
    headers['APP-Code'] = AIHUBMIX_APP_CODE;
  }

  return headers;
}
