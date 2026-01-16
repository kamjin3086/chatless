"use client";

/**
 * MCP 服务器快速切换组件
 * 
 * ## 重构说明
 * 
 * 使用统一的 ActionPanel 组件实现，保持样式一致性。
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Plug, Settings, RotateCcw, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  getEnabledConfiguredServers,
  getConnectedServers,
  getGlobalEnabledServers,
  setGlobalEnabledServers,
} from "@/lib/mcp/chatIntegration";
import Link from "next/link";
import { McpToolListTip } from "@/components/mcp/McpToolListTip";
import {
  ActionPanel,
  ActionPanelTrigger,
  ActionPanelContent,
  ActionPanelHeader,
  ActionPanelList,
  ActionPanelEmpty,
} from "@/components/ui/action-panel";

interface McpQuickToggleProps {
  onInsertMention?: (name: string) => void;
}

export function McpQuickToggle({ onInsertMention }: McpQuickToggleProps) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<string[]>([]);
  const [connected, setConnected] = useState<string[]>([]);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [toolsMap, setToolsMap] = useState<Record<string, any[]>>({});

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

  // 打开时预取工具列表
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const { persistentCache } = await import("@/lib/mcp/persistentCache");
        for (const name of connected) {
          if (!toolsMap[name]) {
            try {
              const tools = await persistentCache.getToolsWithCache(name);
              setToolsMap((prev) => ({
                ...prev,
                [name]: Array.isArray(tools) ? tools : [],
              }));
            } catch {
              /* ignore single server error */
            }
          }
        }
      } catch {
        /* noop */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connected.length]);

  const toggle = async (name: string) => {
    const next = enabled.includes(name)
      ? enabled.filter((n) => n !== name)
      : [...enabled, name];
    setEnabled(next);
    await setGlobalEnabledServers(next);
  };

  const handleConnect = async (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setBusy(name);
      const { serverManager } = await import("@/lib/mcp/ServerManager");
      const { Store } = await import("@tauri-apps/plugin-store");
      const store = await Store.load("mcp_servers.json");
      const list =
        (await store.get<Array<{ name: string; config: any }>>("servers")) ||
        [];
      const item = list.find((s) => s.name === name);
      if (item) {
        await serverManager.startServer(item.name, item.config);
        setConnected(await getConnectedServers());
      }
    } catch (e) {
      void e;
    }
    setBusy(null);
  };

  const headerAction = (
    <Link
      href="/settings?tab=mcpServers"
      onClick={() => setOpen(false)}
      className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
      title="前往 MCP 服务器设置"
    >
      <Settings className="w-3.5 h-3.5" />
    </Link>
  );

  return (
    <ActionPanel open={open} onOpenChange={setOpen}>
      <ActionPanelTrigger>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600"
          title="启用的 MCP"
        >
          <Plug className="w-4 h-4" />
        </Button>
      </ActionPanelTrigger>

      <ActionPanelContent width="lg" maxHeight="20rem">
        <ActionPanelHeader
          title="MCP 服务器"
          subtitle={`${connected.length}/${all.length} 已连接`}
          icon={<Plug className="w-4 h-4" />}
          action={headerAction}
        />

        <ActionPanelList maxHeight="14rem" className="mt-2">
          {all.length === 0 ? (
            <ActionPanelEmpty
              icon={<Plug className="w-8 h-8" />}
              title="暂无配置的 MCP 服务器"
              description="前往设置页面添加服务器"
            />
          ) : (
            all.map((name) => (
              <ServerItem
                key={name}
                name={name}
                isConnected={connected.includes(name)}
                isEnabled={enabled.includes(name)}
                isBusy={busy === name}
                tools={toolsMap[name]}
                onToggle={() => toggle(name)}
                onConnect={(e) => handleConnect(name, e)}
                onInsertMention={() => {
                  onInsertMention?.(name);
                  setOpen(false);
                }}
              />
            ))
          )}
        </ActionPanelList>
      </ActionPanelContent>
    </ActionPanel>
  );
}

// 服务器列表项
interface ServerItemProps {
  name: string;
  isConnected: boolean;
  isEnabled: boolean;
  isBusy: boolean;
  tools?: any[];
  onToggle: () => void;
  onConnect: (e: React.MouseEvent) => void;
  onInsertMention: () => void;
}

function ServerItem({
  name,
  isConnected,
  isEnabled,
  isBusy,
  tools,
  onToggle,
  onConnect,
  onInsertMention,
}: ServerItemProps) {
  return (
    <div
      className={cn(
        "group flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm",
        isConnected
          ? "hover:bg-gray-50 dark:hover:bg-gray-700/50"
          : "opacity-75"
      )}
    >
      <label className="flex items-center gap-2 flex-1 cursor-pointer">
        <Checkbox
          checked={isEnabled}
          onCheckedChange={onToggle}
          className="h-4 w-4"
        />
        <span className="truncate font-medium text-gray-700 dark:text-gray-200">
          {name}
        </span>

        {/* 工具数量提示 */}
        {isConnected && Array.isArray(tools) && tools.length > 0 && (
          <McpToolListTip toolCount={tools.length} tools={tools}>
            <span className="ml-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md cursor-help text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700">
              <svg
                className="w-2.5 h-2.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              {tools.length}
            </span>
          </McpToolListTip>
        )}

        {/* 未连接标签 */}
        {!isConnected && (
          <span className="ml-auto text-[10px] text-gray-400">未连接</span>
        )}
      </label>

      {/* 连接按钮 */}
      {!isConnected && (
        <button
          className="ml-1 inline-flex items-center gap-1 text-[11px] text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded px-2 py-0.5 transition-colors"
          title="尝试连接该服务器"
          onClick={onConnect}
        >
          {isBusy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RotateCcw className="w-3.5 h-3.5" />
          )}
        </button>
      )}

      {/* @ 引用按钮 */}
      {isConnected && (
        <button
          className="ml-2 text-[11px] text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded px-2 py-0.5 opacity-0 group-hover:opacity-100 transition-all"
          title="在输入框插入 @ 引用"
          onClick={onInsertMention}
        >
          @ 引用
        </button>
      )}
    </div>
  );
}
