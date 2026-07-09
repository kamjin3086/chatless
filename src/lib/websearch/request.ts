import type { SearchProvider, WebSearchConfig } from '@/store/webSearchStore';

const splitList = (value: string): string[] =>
  value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);

export function buildSearchRequest(
  cfg: WebSearchConfig,
  provider: SearchProvider,
  query: string,
  apiKey?: string,
  cseId?: string,
): Record<string, unknown> {
  const request: Record<string, unknown> = { provider, query, apiKey, cseId };
  if (provider === 'duckduckgo' || provider === 'custom_scrape') {
    Object.assign(request, {
      limit: cfg.ddgLimit, kl: cfg.ddgKl || undefined,
      acceptLanguage: cfg.ddgAcceptLanguage || undefined,
      safe: cfg.ddgSafe, site: cfg.ddgSite || undefined,
    });
  } else if (provider === 'ollama') {
    request.maxResults = cfg.ollamaMaxResults;
  } else if (provider === 'tavily') {
    Object.assign(request, {
      maxResults: cfg.tavilyMaxResults, searchDepth: cfg.tavilySearchDepth,
      topic: cfg.tavilyTopic, includeDomains: splitList(cfg.tavilyIncludeDomains),
      excludeDomains: splitList(cfg.tavilyExcludeDomains),
    });
  } else if (provider === 'brave') {
    Object.assign(request, {
      maxResults: cfg.braveCount, country: cfg.braveCountry.trim() || undefined,
      searchLang: cfg.braveSearchLang.trim() || undefined,
      safeSearch: cfg.braveSafeSearch, extraSnippets: cfg.braveExtraSnippets,
    });
  } else if (provider === 'searxng') {
    Object.assign(request, {
      baseUrl: cfg.searxngBaseUrl.trim(), maxResults: cfg.searxngLimit,
      language: cfg.searxngLanguage.trim(), categories: cfg.searxngCategories.trim(),
      safeSearch: String(cfg.searxngSafeSearch), timeRange: cfg.searxngTimeRange || undefined,
    });
  }
  return request;
}
