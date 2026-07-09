import { create } from 'zustand';
import StorageUtil from '@/lib/storage';

export type SearchProvider =
  | 'google' | 'bing' | 'ollama' | 'duckduckgo' | 'custom_scrape'
  | 'tavily' | 'brave' | 'searxng';

type ConversationProviderMap = Record<string, SearchProvider | undefined>;

export interface WebSearchConfig {
  isWebSearchEnabled: boolean;
  autoAuthorizeWebSearch: boolean;
  provider: SearchProvider;
  apiKeyGoogle: string;
  cseIdGoogle: string;
  apiKeyBing: string;
  apiKeyOllama: string;
  apiKeyTavily: string;
  apiKeyBrave: string;
  searxngBaseUrl: string;
  ddgLimit: number;
  ddgKl: string;
  ddgAcceptLanguage: string;
  ddgSafe: boolean;
  ddgSite: string;
  ollamaMaxResults: number;
  tavilyMaxResults: number;
  tavilySearchDepth: 'basic' | 'advanced' | 'fast' | 'ultra-fast';
  tavilyTopic: 'general' | 'news' | 'finance';
  tavilyIncludeDomains: string;
  tavilyExcludeDomains: string;
  braveCount: number;
  braveCountry: string;
  braveSearchLang: string;
  braveSafeSearch: 'off' | 'moderate' | 'strict';
  braveExtraSnippets: boolean;
  searxngLimit: number;
  searxngLanguage: string;
  searxngCategories: string;
  searxngSafeSearch: 0 | 1 | 2;
  searxngTimeRange: '' | 'day' | 'month' | 'year';
  fetchMaxContentChars: number;
  fetchMaxLinks: number;
  fetchUseReadability: boolean;
  conversationProviders: ConversationProviderMap;
}

interface WebSearchState extends WebSearchConfig {
  initialized: boolean;
  toggleWebSearch: (enabled: boolean) => void;
  setAutoAuthorizeWebSearch: (enabled: boolean) => void;
  setSearchProvider: (provider: SearchProvider) => void;
  setGoogleCredentials: (apiKey: string, cseId: string) => void;
  setBingCredentials: (apiKey: string) => void;
  setOllamaApiKey: (apiKey: string) => void;
  setDdgAdvanced: (opts: Partial<Pick<WebSearchConfig, 'ddgLimit'|'ddgKl'|'ddgAcceptLanguage'|'ddgSafe'|'ddgSite'>>) => void;
  setOllamaAdvanced: (opts: Partial<Pick<WebSearchConfig, 'ollamaMaxResults'>>) => void;
  setTavilyConfig: (opts: Partial<Pick<WebSearchConfig, 'apiKeyTavily'|'tavilyMaxResults'|'tavilySearchDepth'|'tavilyTopic'|'tavilyIncludeDomains'|'tavilyExcludeDomains'>>) => void;
  setBraveConfig: (opts: Partial<Pick<WebSearchConfig, 'apiKeyBrave'|'braveCount'|'braveCountry'|'braveSearchLang'|'braveSafeSearch'|'braveExtraSnippets'>>) => void;
  setSearxngConfig: (opts: Partial<Pick<WebSearchConfig, 'searxngBaseUrl'|'searxngLimit'|'searxngLanguage'|'searxngCategories'|'searxngSafeSearch'|'searxngTimeRange'>>) => void;
  setFetchAdvanced: (opts: Partial<Pick<WebSearchConfig, 'fetchMaxContentChars'|'fetchMaxLinks'>>) => void;
  setFetchReadability: (enabled: boolean) => void;
  setConversationProvider: (conversationId: string, provider: SearchProvider | undefined) => void;
  getConversationProvider: (conversationId: string) => SearchProvider;
  getAvailableProviders: () => SearchProvider[];
  _save: () => Promise<void>;
  _load: () => Promise<void>;
}

const STORE_FILE = 'web-search-settings.json';
const STORE_KEY = 'web_search_config';

const defaultConfig: WebSearchConfig = {
  isWebSearchEnabled: false,
  autoAuthorizeWebSearch: true,
  provider: 'duckduckgo',
  apiKeyGoogle: '', cseIdGoogle: '', apiKeyBing: '', apiKeyOllama: '',
  apiKeyTavily: '', apiKeyBrave: '', searxngBaseUrl: '',
  ddgLimit: 5, ddgKl: '', ddgAcceptLanguage: '', ddgSafe: false, ddgSite: '',
  ollamaMaxResults: 5,
  tavilyMaxResults: 5, tavilySearchDepth: 'basic', tavilyTopic: 'general',
  tavilyIncludeDomains: '', tavilyExcludeDomains: '',
  braveCount: 5, braveCountry: '', braveSearchLang: '',
  braveSafeSearch: 'moderate', braveExtraSnippets: false,
  searxngLimit: 5, searxngLanguage: 'all', searxngCategories: 'general',
  searxngSafeSearch: 0, searxngTimeRange: '',
  fetchMaxContentChars: 2000, fetchMaxLinks: 50, fetchUseReadability: true,
  conversationProviders: {},
};

export const useWebSearchStore = create<WebSearchState>((set, get) => {
  const savePatch = (patch: Partial<WebSearchConfig>) => {
    set(patch);
    void get()._save();
  };
  return {
    ...defaultConfig,
    initialized: false,
    toggleWebSearch: (isWebSearchEnabled) => savePatch({ isWebSearchEnabled }),
    setAutoAuthorizeWebSearch: (autoAuthorizeWebSearch) => savePatch({ autoAuthorizeWebSearch }),
    setSearchProvider: (provider) => savePatch({ provider }),
    setGoogleCredentials: (apiKeyGoogle, cseIdGoogle) => savePatch({ apiKeyGoogle, cseIdGoogle }),
    setBingCredentials: (apiKeyBing) => savePatch({ apiKeyBing }),
    setOllamaApiKey: (apiKeyOllama) => savePatch({ apiKeyOllama }),
    setDdgAdvanced: savePatch,
    setOllamaAdvanced: savePatch,
    setTavilyConfig: savePatch,
    setBraveConfig: savePatch,
    setSearxngConfig: savePatch,
    setFetchAdvanced: savePatch,
    setFetchReadability: (fetchUseReadability) => savePatch({ fetchUseReadability }),
    setConversationProvider: (conversationId, provider) => {
      const conversationProviders = { ...get().conversationProviders };
      if (provider) conversationProviders[conversationId] = provider;
      else delete conversationProviders[conversationId];
      savePatch({ conversationProviders });
    },
    getConversationProvider: (conversationId) => get().conversationProviders[conversationId] || get().provider,
    getAvailableProviders: () => {
      const s = get();
      const providers: SearchProvider[] = ['duckduckgo', 'custom_scrape'];
      if (s.apiKeyGoogle && s.cseIdGoogle) providers.push('google');
      if (s.apiKeyBing) providers.push('bing');
      if (s.apiKeyOllama) providers.push('ollama');
      if (s.apiKeyTavily) providers.push('tavily');
      if (s.apiKeyBrave) providers.push('brave');
      if (s.searxngBaseUrl) providers.push('searxng');
      return providers;
    },
    _save: async () => {
      const cfg = JSON.parse(JSON.stringify(get())) as WebSearchConfig;
      await StorageUtil.setItem<WebSearchConfig>(STORE_KEY, cfg, STORE_FILE);
    },
    _load: async () => {
      const saved = await StorageUtil.getItem<WebSearchConfig>(STORE_KEY, null, STORE_FILE);
      set({ ...defaultConfig, ...(saved && typeof saved === 'object' ? saved : {}), initialized: true });
    },
  };
});

void useWebSearchStore.getState()._load().catch((error) => {
  console.error('Failed to load web search settings:', error);
});
