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

  it('drops retired official APIs from the catalog', () => {
    const ids = AVAILABLE_PROVIDERS_CATALOG.map((p) => p.id);
    expect(ids).not.toContain('yi');
    expect(ids).not.toContain('github');
  });

  it('uses current live default URLs after domain and /v1 cleanup', () => {
    const byId = Object.fromEntries(AVAILABLE_PROVIDERS_CATALOG.map((p) => [p.id, p]));
    expect(byId.tokenflux?.defaultUrl).toBe('https://tokenflux.ai/v1');
    expect(byId.ocoolai?.defaultUrl).toBe('https://one.ocoolai.com/v1');
    expect(byId.silicon?.defaultUrl).toBe('https://api.siliconflow.cn/v1');
    expect(byId.hyperbolic?.defaultUrl).toBe('https://api.hyperbolic.xyz/v1');
    expect(byId.baichuan?.defaultUrl).toBe('https://api.baichuan-ai.com/v1');
    expect(byId.hunyuan?.defaultUrl).toBe('https://api.hunyuan.cloud.tencent.com/v1');
    expect(byId.qiniu?.defaultUrl).toBe('https://api.qnaigc.com/v1');
    expect(byId.lanyun?.defaultUrl).toBe('https://maas-api.lanyun.net/v1');
    expect(byId.infini?.defaultUrl).toBe('https://cloud.infini-ai.com/maas/v1');
    expect(byId.xirang?.defaultUrl).toBe('https://wishub-x1.ctyun.cn/v1');
    expect(byId.dmxapi?.defaultUrl).toBe('https://www.dmxapi.cn/v1');
    expect(byId.alayanew?.defaultUrl).toBe('https://deepseek.alayanew.com/v1');
    expect(byId.burncloud?.defaultUrl).toBe('https://ai.burncloud.com/v1');
    expect(byId.ph8?.defaultUrl).toBe('https://ph8.co/v1');
    expect(byId.voyageai?.defaultUrl).toBe('https://api.voyageai.com/v1');
  });

  it('annotates embedding-only and partially offline providers', () => {
    const voyageai = AVAILABLE_PROVIDERS_CATALOG.find((p) => p.id === 'voyageai');
    const ph8 = AVAILABLE_PROVIDERS_CATALOG.find((p) => p.id === 'ph8');
    expect(voyageai?.notes).toMatch(/Embedding/i);
    expect(ph8?.notes).toMatch(/海外模型已下线/);
  });
});
