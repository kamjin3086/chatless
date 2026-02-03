"use client";

import { useMemo } from "react";
import { SettingsCard, SettingsPageHeader } from "./SettingsCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { SelectField } from "./SelectField";
import { ToggleSwitch } from "./ToggleSwitch";
import { useWebSearchStore, type SearchProvider } from "@/store/webSearchStore";
import { linkOpener } from "@/lib/utils/linkOpener";
import { Globe, ExternalLink, ShieldCheck } from "lucide-react";
import { providerOptions } from "@/lib/websearch/registry";

export function WebSearchSettings() {
  const store = useWebSearchStore();
  const available = useMemo(() => store.getAvailableProviders(), [store.isWebSearchEnabled, store.apiKeyGoogle, store.cseIdGoogle, store.apiKeyBing]);

  const openLink = async (url: string) => {
    try { await linkOpener.openLink(url); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-4">
      <SettingsPageHeader 
        title="网络搜索" 
        description="配置搜索引擎，模型在需要最新信息时使用。"
      />

      <SettingsCard>
        <SettingsSectionHeader icon={Globe} title="搜索配置" />
        <div className="space-y-3">
          <ToggleSwitch
            label="自动授权网络搜索"
            checked={store.autoAuthorizeWebSearch}
            onChange={(v) => store.setAutoAuthorizeWebSearch(!!v)}
            tooltip="开启后调用搜索时跳过确认"
          />

          <SelectField
            label="默认搜索引擎"
            value={store.provider}
            onChange={(v) => store.setSearchProvider(v as SearchProvider)}
            options={providerOptions() as any}
          />

          {/* Google 配置 */}
          {store.provider === "google" && (
            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  placeholder="Google API Key"
                  value={store.apiKeyGoogle}
                  onChange={(e) => store.setGoogleCredentials(e.target.value, store.cseIdGoogle)}
                  className="flex-1 h-7 px-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none"
                />
                <button onClick={() => openLink("https://console.cloud.google.com/apis/credentials")} className="text-[10px] text-blue-500 hover:text-blue-600 flex items-center gap-0.5">
                  <ExternalLink className="w-3 h-3" /> API
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Google CSE ID"
                  value={store.cseIdGoogle}
                  onChange={(e) => store.setGoogleCredentials(store.apiKeyGoogle, e.target.value)}
                  className="flex-1 h-7 px-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none"
                />
                <button onClick={() => openLink("https://programmablesearchengine.google.com/")} className="text-[10px] text-blue-500 hover:text-blue-600 flex items-center gap-0.5">
                  <ExternalLink className="w-3 h-3" /> CSE
                </button>
              </div>
            </div>
          )}

          {/* Bing 配置 */}
          {store.provider === "bing" && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  placeholder="Bing API Key"
                  value={store.apiKeyBing}
                  onChange={(e) => store.setBingCredentials(e.target.value)}
                  className="flex-1 h-7 px-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none"
                />
                <button onClick={() => openLink("https://portal.azure.com/")} className="text-[10px] text-blue-500 hover:text-blue-600 flex items-center gap-0.5">
                  <ExternalLink className="w-3 h-3" /> Azure
                </button>
              </div>
            </div>
          )}

          {/* Ollama 配置 */}
          {store.provider === "ollama" && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  placeholder="Ollama API Key"
                  value={store.apiKeyOllama}
                  onChange={(e) => store.setOllamaApiKey(e.target.value)}
                  className="flex-1 h-7 px-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none"
                />
                <button onClick={() => openLink("https://ollama.com/blog/web-search")} className="text-[10px] text-blue-500 hover:text-blue-600 flex items-center gap-0.5">
                  <ExternalLink className="w-3 h-3" /> 文档
                </button>
              </div>
            </div>
          )}

          {/* 自定义抓取说明 */}
          {store.provider === "custom_scrape" && (
            <div className="flex items-start gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <ShieldCheck className="w-3.5 h-3.5 mt-0.5 text-emerald-500 flex-shrink-0" />
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                使用内置抓取器，无需 API Key。结果可能不稳定，建议配置代理。
              </p>
            </div>
          )}

          {/* 高级参数（折叠） */}
          {(store.provider === 'duckduckgo' || store.provider === 'custom_scrape') && (
            <details className="pt-2 border-t border-slate-100 dark:border-slate-800">
              <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300">
                高级参数
              </summary>
              <div className="mt-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-600 dark:text-slate-400">结果数量</span>
                  <input
                    type="number"
                    value={store.ddgLimit}
                    onChange={(e) => store.setDdgAdvanced({ ddgLimit: Math.max(1, Math.min(10, Number(e.target.value) || 5)) })}
                    className="w-16 h-6 px-2 text-[10px] border border-slate-200/60 dark:border-slate-700/40 rounded bg-white dark:bg-slate-800"
                  />
                </div>
                <ToggleSwitch
                  label="安全搜索"
                  checked={!!store.ddgSafe}
                  onChange={(v) => store.setDdgAdvanced({ ddgSafe: !!v })}
                />
              </div>
            </details>
          )}

          {/* 可用提供商 */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="text-[10px] text-slate-400 mb-1.5">可用</div>
            <div className="flex flex-wrap gap-1">
              {available.map((p) => (
                <span key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  {p}
                </span>
              ))}
            </div>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}
