"use client";

import { useMemo } from "react";
import { ExternalLink, Globe } from "lucide-react";
import { SettingsCard, SettingsPageHeader } from "./SettingsCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { SelectField } from "./SelectField";
import { ToggleSwitch } from "./ToggleSwitch";
import { useWebSearchStore, type SearchProvider } from "@/store/webSearchStore";
import { linkOpener } from "@/lib/utils/linkOpener";
import { providerOptions } from "@/lib/websearch/registry";

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

function DocsLink({ url }: { url: string }) {
  return <button onClick={() => void linkOpener.openLink(url)}
    className="inline-flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-600">
    <ExternalLink className="w-3 h-3" /> 官方文档
  </button>;
}

export function WebSearchSettings() {
  const store = useWebSearchStore();
  const available = useMemo(() => store.getAvailableProviders(), [
    store.apiKeyGoogle, store.cseIdGoogle, store.apiKeyBing, store.apiKeyOllama,
    store.apiKeyTavily, store.apiKeyBrave, store.searxngBaseUrl,
  ]);

  return <div className="space-y-4">
    <SettingsPageHeader title="网络搜索" description="配置搜索服务、结果数量、区域语言和安全搜索策略。" />
    <SettingsCard>
      <SettingsSectionHeader icon={Globe} title="搜索配置" />
      <div className="space-y-3">
        <ToggleSwitch label="自动授权网络搜索" checked={store.autoAuthorizeWebSearch}
          onChange={(value) => store.setAutoAuthorizeWebSearch(!!value)}
          tooltip="开启后，模型调用搜索工具时不再逐次确认。" />
        <SelectField label="默认搜索引擎" value={store.provider}
          onChange={(value) => store.setSearchProvider(value as SearchProvider)}
          options={providerOptions() as any} />

        {store.provider === "google" && <div className="grid gap-2 pt-2 border-t">
          <Field label="API Key" type="password" value={store.apiKeyGoogle}
            onChange={(v) => store.setGoogleCredentials(v, store.cseIdGoogle)} />
          <Field label="Programmable Search Engine ID" value={store.cseIdGoogle}
            onChange={(v) => store.setGoogleCredentials(store.apiKeyGoogle, v)} />
          <DocsLink url="https://developers.google.com/custom-search/v1/overview" />
        </div>}

        {store.provider === "bing" && <div className="space-y-2 pt-2 border-t">
          <Field label="API Key" type="password" value={store.apiKeyBing} onChange={store.setBingCredentials} />
        </div>}

        {store.provider === "ollama" && <div className="space-y-2 pt-2 border-t">
          <Field label="API Key" type="password" value={store.apiKeyOllama} onChange={store.setOllamaApiKey} />
          <Field label="结果数量（1–10）" type="number" value={store.ollamaMaxResults}
            onChange={(v) => store.setOllamaAdvanced({ ollamaMaxResults: clamp(v, 1, 10) })} />
        </div>}

        {store.provider === "tavily" && <div className="grid gap-2 pt-2 border-t">
          <Field label="API Key" type="password" value={store.apiKeyTavily}
            onChange={(v) => store.setTavilyConfig({ apiKeyTavily: v })} />
          <Field label="结果数量（1–20）" type="number" value={store.tavilyMaxResults}
            onChange={(v) => store.setTavilyConfig({ tavilyMaxResults: clamp(v, 1, 20) })} />
          <SelectField label="搜索深度" value={store.tavilySearchDepth}
            onChange={(v) => store.setTavilyConfig({ tavilySearchDepth: v as any })}
            options={["basic", "advanced", "fast", "ultra-fast"].map(value => ({ value, label: value })) as any} />
          <SelectField label="主题" value={store.tavilyTopic}
            onChange={(v) => store.setTavilyConfig({ tavilyTopic: v as any })}
            options={["general", "news", "finance"].map(value => ({ value, label: value })) as any} />
          <Field label="包含域名（逗号或空格分隔）" value={store.tavilyIncludeDomains}
            onChange={(v) => store.setTavilyConfig({ tavilyIncludeDomains: v })} />
          <Field label="排除域名（逗号或空格分隔）" value={store.tavilyExcludeDomains}
            onChange={(v) => store.setTavilyConfig({ tavilyExcludeDomains: v })} />
          <DocsLink url="https://docs.tavily.com/documentation/api-reference/endpoint/search" />
        </div>}

        {store.provider === "brave" && <div className="grid gap-2 pt-2 border-t">
          <Field label="API Key" type="password" value={store.apiKeyBrave}
            onChange={(v) => store.setBraveConfig({ apiKeyBrave: v })} />
          <Field label="结果数量（1–20）" type="number" value={store.braveCount}
            onChange={(v) => store.setBraveConfig({ braveCount: clamp(v, 1, 20) })} />
          <Field label="国家代码（如 CN、US，可空）" value={store.braveCountry}
            onChange={(v) => store.setBraveConfig({ braveCountry: v })} />
          <Field label="搜索语言（如 zh-hans、en，可空）" value={store.braveSearchLang}
            onChange={(v) => store.setBraveConfig({ braveSearchLang: v })} />
          <SelectField label="安全搜索" value={store.braveSafeSearch}
            onChange={(v) => store.setBraveConfig({ braveSafeSearch: v as any })}
            options={["off", "moderate", "strict"].map(value => ({ value, label: value })) as any} />
          <ToggleSwitch label="返回额外摘要" checked={store.braveExtraSnippets}
            onChange={(v) => store.setBraveConfig({ braveExtraSnippets: !!v })} />
          <DocsLink url="https://api-dashboard.search.brave.com/api-reference/web/search/get" />
        </div>}

        {store.provider === "searxng" && <div className="grid gap-2 pt-2 border-t">
          <Field label="实例地址" placeholder="https://searx.example.com" value={store.searxngBaseUrl}
            onChange={(v) => store.setSearxngConfig({ searxngBaseUrl: v })} />
          <Field label="结果数量（1–20）" type="number" value={store.searxngLimit}
            onChange={(v) => store.setSearxngConfig({ searxngLimit: clamp(v, 1, 20) })} />
          <Field label="语言" value={store.searxngLanguage}
            onChange={(v) => store.setSearxngConfig({ searxngLanguage: v })} />
          <Field label="分类（逗号分隔）" value={store.searxngCategories}
            onChange={(v) => store.setSearxngConfig({ searxngCategories: v })} />
          <SelectField label="安全搜索" value={String(store.searxngSafeSearch)}
            onChange={(v) => store.setSearxngConfig({ searxngSafeSearch: Number(v) as 0|1|2 })}
            options={[0, 1, 2].map(value => ({ value: String(value), label: ["关闭", "适中", "严格"][value] })) as any} />
          <SelectField label="时间范围" value={store.searxngTimeRange}
            onChange={(v) => store.setSearxngConfig({ searxngTimeRange: v as any })}
            options={[["", "不限"], ["day", "一天"], ["month", "一月"], ["year", "一年"]].map(([value, label]) => ({ value, label })) as any} />
          <DocsLink url="https://docs.searxng.org/dev/search_api.html" />
        </div>}

        {(store.provider === "duckduckgo" || store.provider === "custom_scrape") &&
          <div className="grid gap-2 pt-2 border-t">
            <Field label="结果数量（1–10）" type="number" value={store.ddgLimit}
              onChange={(v) => store.setDdgAdvanced({ ddgLimit: clamp(v, 1, 10) })} />
            <Field label="区域/语言（如 cn-zh、us-en）" value={store.ddgKl}
              onChange={(v) => store.setDdgAdvanced({ ddgKl: v })} />
            <Field label="Accept-Language（可空）" value={store.ddgAcceptLanguage}
              onChange={(v) => store.setDdgAdvanced({ ddgAcceptLanguage: v })} />
            <Field label="限定站点（可空）" value={store.ddgSite}
              onChange={(v) => store.setDdgAdvanced({ ddgSite: v })} />
            <ToggleSwitch label="安全搜索" checked={store.ddgSafe}
              onChange={(v) => store.setDdgAdvanced({ ddgSafe: !!v })} />
          </div>}

        <div className="pt-2 border-t text-[10px] text-slate-400">
          已可用：{available.join("、")}
        </div>
      </div>
    </SettingsCard>
  </div>;
}

function clamp(value: string, min: number, max: number) {
  return Math.max(min, Math.min(max, Number(value) || min));
}
