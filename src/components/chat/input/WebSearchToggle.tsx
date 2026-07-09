"use client";

/**
 * 网络搜索快速切换组件
 * 
 * 使用统一的 ActionPanel 组件实现，提供网络搜索开关和提供商选择
 * 启用时显示蓝色高亮
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Globe, Check, Settings, ExternalLink } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useWebSearchStore, type SearchProvider } from "@/store/webSearchStore";
import { useRouter } from "next/navigation";
import {
  ActionPanel,
  ActionPanelTrigger,
  ActionPanelContent,
  ActionPanelHeader,
  ActionPanelList,
  ActionPanelItem,
  ActionPanelDivider,
  ActionPanelFooter,
} from "@/components/ui/action-panel";
import { listAllProviders, providerConfiguredMap, providerLabel } from "@/lib/websearch/registry";

interface WebSearchToggleProps {
  conversationId?: string;
  disabled?: boolean;
}

export function WebSearchToggle({
  conversationId,
  disabled = false,
}: WebSearchToggleProps) {
  const [open, setOpen] = useState(false);
  const webSearch = useWebSearchStore();
  const router = useRouter();

  const configured = providerConfiguredMap({
    apiKeyGoogle: webSearch.apiKeyGoogle,
    cseIdGoogle: webSearch.cseIdGoogle,
    apiKeyBing: webSearch.apiKeyBing,
    apiKeyOllama: webSearch.apiKeyOllama,
    apiKeyTavily: webSearch.apiKeyTavily,
    apiKeyBrave: webSearch.apiKeyBrave,
    searxngBaseUrl: webSearch.searxngBaseUrl,
  });

  const currentProvider = conversationId
    ? webSearch.getConversationProvider(conversationId)
    : webSearch.provider;

  const handleProviderChange = (provider: SearchProvider) => {
    if (!configured[provider]) return;
    if (conversationId) {
      webSearch.setConversationProvider(conversationId, provider as any);
    }
  };

  const handleGoToSettings = () => {
    setOpen(false);
    router.push("/settings?tab=webSearch");
  };

  const isEnabled = webSearch.isWebSearchEnabled;

  return (
    <ActionPanel open={open} onOpenChange={setOpen}>
      <ActionPanelTrigger>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          className={cn(
            "h-8 w-8 shrink-0 rounded-lg transition-all duration-150",
            isEnabled
              ? "bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/50"
              : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          )}
          title="网络搜索"
        >
          <Globe className="w-4 h-4" />
        </Button>
      </ActionPanelTrigger>

      <ActionPanelContent width="md" maxHeight="20rem">
        <ActionPanelHeader
          title="网络搜索"
          icon={<Globe className={cn("w-4 h-4", isEnabled ? "text-sky-500" : "text-slate-400")} />}
          action={
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-[11px]",
                isEnabled ? "text-sky-600 dark:text-sky-400" : "text-slate-400"
              )}>
                {isEnabled ? "已启用" : "已禁用"}
              </span>
              <Switch
                size="sm"
                checked={isEnabled}
                onCheckedChange={(v) => webSearch.toggleWebSearch(!!v)}
              />
            </div>
          }
        />

        <ActionPanelDivider />

        <div className="px-3 py-2">
          <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide">
            搜索提供商
          </p>
        </div>

        <ActionPanelList maxHeight="10rem">
          {conversationId ? (
            listAllProviders().map((provider) => {
              const isConfigured = configured[provider];
              const isSelected = currentProvider === provider;

              return (
                <ActionPanelItem
                  key={provider}
                  title={providerLabel(provider)}
                  description={
                    !isConfigured
                      ? "未配置"
                      : provider === "duckduckgo"
                      ? "免费使用"
                      : "已配置"
                  }
                  selected={isSelected}
                  disabled={!isConfigured}
                  suffix={isSelected ? <Check className="w-4 h-4 text-sky-500" /> : null}
                  onClick={() => handleProviderChange(provider)}
                />
              );
            })
          ) : (
            <div className="px-3 py-4 text-center text-[12px] text-slate-400">
              请先选择或创建一个会话
            </div>
          )}
        </ActionPanelList>

        <ActionPanelFooter>
          <button
            onClick={handleGoToSettings}
            className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-sky-600 dark:hover:text-sky-400 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            配置密钥
            <ExternalLink className="w-3 h-3 opacity-60" />
          </button>
        </ActionPanelFooter>
      </ActionPanelContent>
    </ActionPanel>
  );
}
