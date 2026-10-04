"use client";

/**
 * MCP 服务器快速切换组件
 * 
 * 与 WebSearchToggle 保持一致的体验，使用绿色系标识
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Plug, Settings, Check, RotateCcw, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  getEnabledConfiguredServers,
  getConnectedServers,
  getGlobalEnabledServers,
  setGlobalEnabledServers,
} from "@/lib/mcp/chatIntegration";
import Link from "next/link";
import {
  ActionPanel,
  ActionPanelTrigger,
  ActionPanelContent,
  ActionPanelHeader,
  ActionPanelList,
  ActionPanelItem,
  ActionPanelDivider,
  ActionPanelFooter,
  ActionPanelEmpty,
} from "@/components/ui/action-panel";

// MCP 全局开关状态
let mcpGlobalEnabled = true;

interface McpQuickToggleProps {
  onInsertMention?: (name: string) => void;
}

export function McpQuickToggle({ onInsertMention }: McpQuickToggleProps) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<string[]>([]);
  const [connected, setConnected] = useState<string[]>([]);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [globalEnabled, setGlobalEnabled] = useState(mcpGlobalEnabled);
  const [busy, setBusy] = useState<string | null>(null);

  // 加载服务器列表
  useEffect(() => {
    (async () => {
      const list = await getEnabledConfiguredServers();
      setAll(list);
      setConnected(await getConnectedServers());
      const saved = await getGlobalEnabledServers();
      if (!saved || saved.length === 0) {
        setEnabled(list);
        await setGlobalEnabledServers(list);
      } else {
        setEnabled(saved);
      }
    })();
  }, []);

  // 刷新连接状态
  useEffect(() => {
    if (open) {
      getConnectedServers().then(setConnected);
    }
  }, [open]);

  const toggleServer = async (name: string) => {
    const next = enabled.includes(name)
      ? enabled.filter((n) => n !== name)
      : [...enabled, name];
    setEnabled(next);
    await setGlobalEnabledServers(next);
  };

  const toggleGlobal = (v: boolean) => {
    setGlobalEnabled(v);
    mcpGlobalEnabled = v;
  };

  const handleConnect = async (name: string) => {
    try {
      setBusy(name);
      const { serverManager } = await import("@/lib/mcp/ServerManager");
      const { Store } = await import("@tauri-apps/plugin-store");
      const store = await Store.load("mcp_servers.json");
      const list = (await store.get<Array<{ name: string; config: any }>>("servers")) || [];
      const item = list.find((s) => s.name === name);
      if (item) {
        await serverManager.startServer(item.name, item.config);
        setConnected(await getConnectedServers());
      }
    } catch {
      // ignore
    }
    setBusy(null);
  };

  const hasConnected = connected.length > 0;
  const isActive = globalEnabled && hasConnected;

  return (
    <ActionPanel open={open} onOpenChange={setOpen}>
      <ActionPanelTrigger>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "composer-tool h-8 w-8 shrink-0 rounded-md border-0 bg-transparent shadow-none hover:bg-transparent dark:hover:bg-transparent",
            isActive
              ? "glass-chip-ok"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          )}
          title="MCP 服务器"
        >
          <Plug className="w-4 h-4" />
        </Button>
      </ActionPanelTrigger>

      <ActionPanelContent width="md" maxHeight="20rem">
        <ActionPanelHeader
          title="MCP 服务器"
          subtitle={`${connected.length}/${all.length} 已连接`}
          icon={<Plug className={cn("w-4 h-4", isActive ? "text-emerald-500" : "text-slate-400")} />}
          action={
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-[11px]",
                globalEnabled ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"
              )}>
                {globalEnabled ? "已启用" : "已禁用"}
              </span>
              <Switch
                size="sm"
                checked={globalEnabled}
                onCheckedChange={toggleGlobal}
              />
            </div>
          }
        />

        <ActionPanelDivider />

        <ActionPanelList maxHeight="12rem">
          {all.length === 0 ? (
            <ActionPanelEmpty
              icon={<Plug className="w-6 h-6 text-slate-300" />}
              title="暂无配置的服务器"
              description="前往设置页面添加"
            />
          ) : (
            all.map((name) => {
              const isConnected = connected.includes(name);
              const isEnabled = enabled.includes(name);
              const isBusy = busy === name;

              return (
                <ActionPanelItem
                  key={name}
                  icon={
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      isConnected ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"
                    )} />
                  }
                  title={name}
                  description={isConnected ? "已连接" : "未连接"}
                  selected={isEnabled}
                  suffix={
                    <div className="flex items-center gap-1">
                      {!isConnected && (
                        <button
                          className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleConnect(name);
                          }}
                          title="连接"
                        >
                          {isBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                      {isConnected && onInsertMention && (
                        <button
                          className="px-1.5 py-0.5 rounded-md text-[10px] text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
                          onClick={(e) => {
                            e.stopPropagation();
                            onInsertMention(name);
                            setOpen(false);
                          }}
                          title="插入 @引用"
                        >
                          @引用
                        </button>
                      )}
                      {isEnabled && <Check className="w-4 h-4 text-emerald-500" />}
                    </div>
                  }
                  onClick={() => toggleServer(name)}
                />
              );
            })
          )}
        </ActionPanelList>

        <ActionPanelFooter>
          <Link
            href="/settings?tab=mcpServers"
            onClick={() => setOpen(false)}
            className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            管理服务器
          </Link>
        </ActionPanelFooter>
      </ActionPanelContent>
    </ActionPanel>
  );
}
