"use client";

import { useMemo } from "react";
import { ExternalLink, Globe } from "lucide-react";
import { SettingsCard, SettingsPageHeader } from "./SettingsCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { SelectField } from "./SelectField";
import { ToggleSwitch } from "./ToggleSwitch";
import { useWebSearchStore, type SearchProvider, type WebSearchConfig } from "@/store/webSearchStore";
import { linkOpener } from "@/lib/utils/linkOpener";
import { providerLabel, providerOptions } from "@/lib/websearch/registry";
import { getHtmlLang } from "@/i18n";
import { useTranslation } from "@/i18n/useTranslation";
import { useLocaleStore } from "@/store/localeStore";

const inputClass = "w-full h-8 px-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded-md bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none";

function Field({ label, value, type = "text", placeholder, onChange }: {
  label: string; value: string | number; type?: string; placeholder?: string;
  onChange: (value: string) => void;
}) {
  return <label className="block space-y-1">
    <span className="text-[10px] text-slate-500">{label}</span>
    <input className={inputClass} type={type} value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)} />
  </label>;
}

function DocsLink({ url, label }: { url: string; label: string }) {
  return <button onClick={() => void linkOpener.openLink(url)}
    className="inline-flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-600">
    <ExternalLink className="w-3 h-3" /> {label}
  </button>;
}

export function WebSearchSettings() {
  const store = useWebSearchStore();
  const t = useTranslation();
  const locale = useLocaleStore((state) => state.locale);
  const available = useMemo(() => store.getAvailableProviders(), [
    store.apiKeyGoogle, store.cseIdGoogle, store.apiKeyBing, store.apiKeyOllama,
    store.apiKeyTavily, store.apiKeyBrave, store.searxngBaseUrl,
  ]);
  const getProviderLabel = (provider: SearchProvider) =>
    provider === 'custom_scrape' ? t('chatComposer.customSearchProvider') : providerLabel(provider);
  const availableLabels = new Intl.ListFormat(getHtmlLang(locale), { style: 'narrow' })
    .format(available.map(getProviderLabel));
  const resultCountLabel = (max: number) => t('settings.webSearch.resultCount').replace('{0}', String(max));
  const safeSearchOptions = (['off', 'moderate', 'strict'] as const)
    .map(value => ({ value, label: t(`settings.webSearch.safeSearch.${value}`) }));
  const docsLabel = t('settings.webSearch.docs');

  return <div className="space-y-4">
    <SettingsPageHeader title={t('settings.nav.webSearch')} description={t('settings.webSearch.description')} />
    <SettingsCard>
      <SettingsSectionHeader icon={Globe} title={t('settings.webSearch.configuration')} />
      <div className="space-y-3">
        <ToggleSwitch label={t('settings.webSearch.autoAuthorize')} checked={store.autoAuthorizeWebSearch}
          onChange={(value) => store.setAutoAuthorizeWebSearch(!!value)}
          tooltip={t('settings.webSearch.autoAuthorizeHelp')} />
        <SelectField label={t('settings.webSearch.defaultProvider')} value={store.provider}
          onChange={(value) => store.setSearchProvider(value as SearchProvider)}
          options={providerOptions().map(({ value }) => ({ value, label: getProviderLabel(value) }))} />

        {store.provider === "google" && <div className="grid gap-2 pt-2 border-t">
          <Field label={t('settings.webSearch.apiKey')} type="password" value={store.apiKeyGoogle}
            onChange={(v) => store.setGoogleCredentials(v, store.cseIdGoogle)} />
          <Field label={t('settings.webSearch.googleCseId')} value={store.cseIdGoogle}
            onChange={(v) => store.setGoogleCredentials(store.apiKeyGoogle, v)} />
          <DocsLink url="https://developers.google.com/custom-search/v1/overview" label={docsLabel} />
        </div>}

        {store.provider === "bing" && <div className="space-y-2 pt-2 border-t">
          <Field label={t('settings.webSearch.apiKey')} type="password" value={store.apiKeyBing} onChange={store.setBingCredentials} />
        </div>}

        {store.provider === "ollama" && <div className="space-y-2 pt-2 border-t">
          <Field label={t('settings.webSearch.apiKey')} type="password" value={store.apiKeyOllama} onChange={store.setOllamaApiKey} />
          <Field label={resultCountLabel(10)} type="number" value={store.ollamaMaxResults}
            onChange={(v) => store.setOllamaAdvanced({ ollamaMaxResults: clamp(v, 1, 10) })} />
        </div>}

        {store.provider === "tavily" && <div className="grid gap-2 pt-2 border-t">
          <Field label={t('settings.webSearch.apiKey')} type="password" value={store.apiKeyTavily}
            onChange={(v) => store.setTavilyConfig({ apiKeyTavily: v })} />
          <Field label={resultCountLabel(20)} type="number" value={store.tavilyMaxResults}
            onChange={(v) => store.setTavilyConfig({ tavilyMaxResults: clamp(v, 1, 20) })} />
          <SelectField label={t('settings.webSearch.depth')} value={store.tavilySearchDepth}
            onChange={(v) => store.setTavilyConfig({ tavilySearchDepth: v as WebSearchConfig['tavilySearchDepth'] })}
            options={(['basic', 'advanced', 'fast', 'ultra-fast'] as const)
              .map(value => ({ value, label: t(`settings.webSearch.depth.${value}`) }))} />
          <SelectField label={t('settings.webSearch.topic')} value={store.tavilyTopic}
            onChange={(v) => store.setTavilyConfig({ tavilyTopic: v as WebSearchConfig['tavilyTopic'] })}
            options={(['general', 'news', 'finance'] as const)
              .map(value => ({ value, label: t(`settings.webSearch.topic.${value}`) }))} />
          <Field label={t('settings.webSearch.includeDomains')} value={store.tavilyIncludeDomains}
            onChange={(v) => store.setTavilyConfig({ tavilyIncludeDomains: v })} />
          <Field label={t('settings.webSearch.excludeDomains')} value={store.tavilyExcludeDomains}
            onChange={(v) => store.setTavilyConfig({ tavilyExcludeDomains: v })} />
          <DocsLink url="https://docs.tavily.com/documentation/api-reference/endpoint/search" label={docsLabel} />
        </div>}

        {store.provider === "brave" && <div className="grid gap-2 pt-2 border-t">
          <Field label={t('settings.webSearch.apiKey')} type="password" value={store.apiKeyBrave}
            onChange={(v) => store.setBraveConfig({ apiKeyBrave: v })} />
          <Field label={resultCountLabel(20)} type="number" value={store.braveCount}
            onChange={(v) => store.setBraveConfig({ braveCount: clamp(v, 1, 20) })} />
          <Field label={t('settings.webSearch.countryCode')} value={store.braveCountry}
            onChange={(v) => store.setBraveConfig({ braveCountry: v })} />
          <Field label={t('settings.webSearch.searchLanguage')} value={store.braveSearchLang}
            onChange={(v) => store.setBraveConfig({ braveSearchLang: v })} />
          <SelectField label={t('settings.webSearch.safeSearch')} value={store.braveSafeSearch}
            onChange={(v) => store.setBraveConfig({ braveSafeSearch: v as WebSearchConfig['braveSafeSearch'] })}
            options={safeSearchOptions} />
          <ToggleSwitch label={t('settings.webSearch.extraSnippets')} checked={store.braveExtraSnippets}
            onChange={(v) => store.setBraveConfig({ braveExtraSnippets: !!v })} />
          <DocsLink url="https://api-dashboard.search.brave.com/api-reference/web/search/get" label={docsLabel} />
        </div>}

        {store.provider === "searxng" && <div className="grid gap-2 pt-2 border-t">
          <Field label={t('settings.webSearch.instanceUrl')} placeholder="https://searx.example.com" value={store.searxngBaseUrl}
            onChange={(v) => store.setSearxngConfig({ searxngBaseUrl: v })} />
          <Field label={resultCountLabel(20)} type="number" value={store.searxngLimit}
            onChange={(v) => store.setSearxngConfig({ searxngLimit: clamp(v, 1, 20) })} />
          <Field label={t('settings.webSearch.language')} value={store.searxngLanguage}
            onChange={(v) => store.setSearxngConfig({ searxngLanguage: v })} />
          <Field label={t('settings.webSearch.categories')} value={store.searxngCategories}
            onChange={(v) => store.setSearxngConfig({ searxngCategories: v })} />
          <SelectField label={t('settings.webSearch.safeSearch')} value={String(store.searxngSafeSearch)}
            onChange={(v) => store.setSearxngConfig({ searxngSafeSearch: Number(v) as WebSearchConfig['searxngSafeSearch'] })}
            options={safeSearchOptions.map(({ label }, value) => ({ value: String(value), label }))} />
          <SelectField label={t('settings.webSearch.timeRange')} value={store.searxngTimeRange}
            onChange={(v) => store.setSearxngConfig({ searxngTimeRange: v as WebSearchConfig['searxngTimeRange'] })}
            options={[
              { value: '', label: t('settings.webSearch.timeRange.any') },
              ...(['day', 'month', 'year'] as const)
                .map(value => ({ value, label: t(`settings.webSearch.timeRange.${value}`) })),
            ]} />
          <DocsLink url="https://docs.searxng.org/dev/search_api.html" label={docsLabel} />
        </div>}

        {(store.provider === "duckduckgo" || store.provider === "custom_scrape") &&
          <div className="grid gap-2 pt-2 border-t">
            <Field label={resultCountLabel(10)} type="number" value={store.ddgLimit}
              onChange={(v) => store.setDdgAdvanced({ ddgLimit: clamp(v, 1, 10) })} />
            <Field label={t('settings.webSearch.regionLanguage')} value={store.ddgKl}
              onChange={(v) => store.setDdgAdvanced({ ddgKl: v })} />
            <Field label={t('settings.webSearch.acceptLanguage')} value={store.ddgAcceptLanguage}
              onChange={(v) => store.setDdgAdvanced({ ddgAcceptLanguage: v })} />
            <Field label={t('settings.webSearch.restrictToSite')} value={store.ddgSite}
              onChange={(v) => store.setDdgAdvanced({ ddgSite: v })} />
            <ToggleSwitch label={t('settings.webSearch.safeSearch')} checked={store.ddgSafe}
              onChange={(v) => store.setDdgAdvanced({ ddgSafe: !!v })} />
          </div>}

        <div className="pt-2 border-t text-[10px] text-slate-400">
          {t('settings.webSearch.available').replace('{0}', availableLabels)}
        </div>
      </div>
    </SettingsCard>
  </div>;
}

function clamp(value: string, min: number, max: number) {
  return Math.max(min, Math.min(max, Number(value) || min));
}
