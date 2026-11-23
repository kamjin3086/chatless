import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import type { SearchProvider, WebSearchConfig } from '@/store/webSearchStore';
import { NetworkSettings } from '../NetworkSettings';
import { WebSearchSettings } from '../WebSearchSettings';

const localeState = vi.hoisted(() => ({ locale: 'zh' as Locale }));
const webSearchState = vi.hoisted(() => ({
  provider: 'duckduckgo' as SearchProvider,
  autoAuthorizeWebSearch: true,
  apiKeyGoogle: 'g-key',
  cseIdGoogle: 'g-cse',
  apiKeyBing: '',
  apiKeyOllama: '',
  apiKeyTavily: 't-key',
  apiKeyBrave: '',
  searxngBaseUrl: '',
  ddgLimit: 5,
  ddgKl: '',
  ddgAcceptLanguage: '',
  ddgSafe: false,
  ddgSite: '',
  ollamaMaxResults: 5,
  tavilyMaxResults: 10,
  tavilySearchDepth: 'basic' as WebSearchConfig['tavilySearchDepth'],
  tavilyTopic: 'general' as WebSearchConfig['tavilyTopic'],
  tavilyIncludeDomains: '',
  tavilyExcludeDomains: '',
  braveCount: 10,
  braveCountry: '',
  braveSearchLang: '',
  braveSafeSearch: 'moderate' as WebSearchConfig['braveSafeSearch'],
  braveExtraSnippets: false,
  searxngLimit: 10,
  searxngLanguage: '',
  searxngCategories: '',
  searxngSafeSearch: 0 as WebSearchConfig['searxngSafeSearch'],
  searxngTimeRange: '' as WebSearchConfig['searxngTimeRange'],
  getAvailableProviders: () =>
    ['duckduckgo', 'custom_scrape', 'google', 'tavily'] as SearchProvider[],
}));

vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: typeof localeState) => unknown) =>
    select(localeState),
  getState: () => localeState,
}));

vi.mock('@/store/webSearchStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/webSearchStore')>()),
  useWebSearchStore: () => webSearchState,
}));

vi.mock('@/store/networkPreferences', () => ({
  useNetworkPreferences: () => ({
    proxyUrl: '',
    useSystemProxy: false,
    offline: false,
    setProxyUrl: vi.fn(),
    setUseSystemProxy: vi.fn(),
    setOffline: vi.fn(),
  }),
}));

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

function renderBoth(provider: SearchProvider) {
  webSearchState.provider = provider;
  const markup = (locale: Locale) => {
    localeState.locale = locale;
    return (
      renderToStaticMarkup(createElement(NetworkSettings)) +
      renderToStaticMarkup(createElement(WebSearchSettings))
    );
  };
  return { zh: markup('zh'), en: markup('en') };
}

it('keeps no application-owned Chinese copy in the English rendering', () => {
  const { en } = renderBoth('tavily');
  expect(en).not.toMatch(/[\u4e00-\u9fff]/);
});

it('renders network settings in the active language', () => {
  const { zh, en } = renderBoth('duckduckgo');
  expect(zh).toContain('网络设置');
  expect(zh).toContain('代理地址');
  expect(zh).toContain('离线模式');
  expect(zh).toContain('阻止网络请求，仅使用本地模型');
  expect(en).toContain('Network');
  expect(en).toContain('Proxy address');
  expect(en).toContain('Offline mode');
  expect(en).toContain('Block network requests and use local models only');
});

it('localizes the Tavily-only controls, including enum option labels', () => {
  const { zh, en } = renderBoth('tavily');
  expect(zh).toContain('搜索深度');
  expect(zh).toContain('极速');
  expect(zh).toContain('金融');
  expect(zh).toContain('包含域名（逗号或空格分隔）');
  expect(en).toContain('Search depth');
  expect(en).toContain('Ultra fast');
  expect(en).toContain('Finance');
  expect(en).toContain('Include domains (comma or space separated)');
});

it('localizes SearXNG time ranges and keeps the provider list readable', () => {
  const { zh, en } = renderBoth('searxng');
  expect(zh).toContain('时间范围');
  expect(zh).toContain('最近一个月');
  expect(zh).toContain('实例地址');
  expect(en).toContain('Time range');
  expect(en).toContain('Past month');
  expect(en).toContain('Instance URL');
  expect(en).toContain('Available now:');
});

it('formats the result-count label through the catalog placeholder', () => {
  const { zh, en } = renderBoth('duckduckgo');
  expect(zh).toContain('结果数量（1–10）');
  expect(en).toContain('Result count (1–10)');
});
