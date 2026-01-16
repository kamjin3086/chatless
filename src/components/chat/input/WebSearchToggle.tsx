"use client";

/**
 * 网络搜索快速切换组件
 * 
 * ## 设计说明
 * 
 * 使用统一的 ActionPanel 组件实现，提供网络搜索开关和提供商选择。
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Globe, Check, Settings, ExternalLink } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useWebSearchStore } from "@/store/webSearchStore";
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

// 提供商配置类型
interface ProviderConfig {
  apiKeyGoogle: string;
  cseIdGoogle: string;
  apiKeyBing: string;
  apiKeyOllama: string;
}

// 提供商列表
function listAllProviders(): string[] {
  return ["google", "bing", "duckduckgo", "ollama"];
}

// 提供商显示名称
function providerLabel(p: string): string {
  switch (p) {
    case "google":
      return "Google";
    case "bing":
      return "Bing";
    case "duckduckgo":
      return "DuckDuckGo";
    case "ollama":
      return "Ollama Web";
    default:
      return p;
  }
}

// 检查提供商是否已配置
function providerConfiguredMap(config: ProviderConfig): Record<string, boolean> {
  return {
    google: !!(config.apiKeyGoogle && config.cseIdGoogle),
    bing: !!config.apiKeyBing,
    duckduckgo: true, // DuckDuckGo 不需要 API Key
    ollama: !!config.apiKeyOllama,
  };
}

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
  });

  const currentProvider = conversationId
    ? webSearch.getConversationProvider(conversationId)
    : webSearch.provider;

  const handleProviderChange = (provider: string) => {
    if (!configured[provider]) return;
    if (conversationId) {
      webSearch.setConversationProvider(conversationId, provider as any);
    }
  };

  const handleGoToSettings = () => {
    setOpen(false);
    router.push("/settings?tab=webSearch");
  };

  return (
    <ActionPanel open={open} onOpenChange={setOpen}>
      <ActionPanelTrigger>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          className={cn(
            "h-8 w-8 shrink-0 rounded-lg transition-all",
            webSearch.isWebSearchEnabled
              ? "text-blue-500 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800"
              : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          )}
          title="网络搜索"
        >
          <Globe className="w-5 h-5" />
        </Button>
      </ActionPanelTrigger>

      <ActionPanelContent width="md" maxHeight="20rem">
        <ActionPanelHeader
          title="网络搜索"
          icon={<Globe className="w-4 h-4 text-blue-500" />}
          action={
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500">
                {webSearch.isWebSearchEnabled ? "已启用" : "已禁用"}
              </span>
              <Switch
                size="sm"
                checked={webSearch.isWebSearchEnabled}
                onCheckedChange={(v) => webSearch.toggleWebSearch(!!v)}
              />
            </div>
          }
        />

        <ActionPanelDivider />

        <div className="px-2 py-1.5">
          <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
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
                      ? "未配置 - 请在设置中添加密钥"
                      : provider === "duckduckgo"
                      ? "无需 API 密钥"
                      : "已配置"
                  }
                  selected={isSelected}
                  disabled={!isConfigured}
                  suffix={isSelected ? <Check className="w-4 h-4 text-blue-500" /> : null}
                  onClick={() => handleProviderChange(provider)}
                />
              );
            })
          ) : (
            <div className="px-3 py-4 text-center text-[12px] text-gray-500">
              请先选择或创建一个会话
            </div>
          )}
        </ActionPanelList>

        <ActionPanelFooter>
          <button
            onClick={handleGoToSettings}
            className="inline-flex items-center gap-1.5 text-[11px] text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            配置密钥
            <ExternalLink className="w-3 h-3" />
          </button>
        </ActionPanelFooter>
      </ActionPanelContent>
    </ActionPanel>
  );
}

