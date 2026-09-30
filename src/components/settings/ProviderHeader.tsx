"use client";
import React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { Loader2, Wifi, BugPlay, MoreVertical, Undo2, Sliders } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import type { ProviderWithStatus } from "@/hooks/useProviderManagement";

function formatLastCheckedTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) {
    return "刚刚";
  } else if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes}分钟前`;
  } else if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}小时前`;
  } else {
    const days = Math.floor(diff / 86400000);
    return `${days}天前`;
  }
}

interface ProviderHeaderProps {
  provider: ProviderWithStatus;
  isConnecting: boolean;
  isGloballyInitializing: boolean;
  resolvedIconSrc: string;
  onRefresh: (provider: ProviderWithStatus) => void;
  onOpenFetchDebugger?: (provider: ProviderWithStatus) => void;
  hasFetchRule?: boolean;
  onOpenSettings?: () => void;
  onResetUrl?: () => void;
}

function ProviderHeaderImpl(props: ProviderHeaderProps) {
  const {
    provider,
    isConnecting,
    isGloballyInitializing,
    resolvedIconSrc,
    onRefresh,
  } = props;

  return (
    <div className="flex items-center justify-between w-full px-5 py-3 border-b border-slate-200/50 dark:border-slate-700/40">
      <div className="flex items-center gap-2.5 min-w-0 mr-3">
        <div className="w-6 h-6 rounded-md overflow-hidden flex-shrink-0">
          <Image
            src={resolvedIconSrc}
            alt={`${provider.name} 图标`}
            width={24}
            height={24}
            className="w-6 h-6 object-contain"
            priority
            key={`${provider.name}-${resolvedIconSrc}`}
          />
        </div>
        <div className="min-w-0">
          <div className="font-medium text-[15px] text-slate-800 dark:text-slate-100 truncate leading-tight">
            {provider.displayName || provider.name}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-0.5 flex-shrink-0">
        {props.onOpenFetchDebugger && (
          <button
            onClick={(e) => { e.stopPropagation(); props.onOpenFetchDebugger?.(provider); }}
            className={cn(
              "p-1.5 rounded-lg focus:outline-none transition-colors",
              props.hasFetchRule
                ? "text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            )}
            title="模型获取调试器"
          >
            <BugPlay className="w-4 h-4" />
          </button>
        )}
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  onRefresh(provider);
                }}
                disabled={isConnecting || isGloballyInitializing}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center">
              <div className="text-xs max-w-xs">
                {isConnecting ? (
                  <p>正在检查连接…</p>
                ) : provider.lastCheckedAt ? (
                  <div>
                    <p className="font-medium">上次检查：{formatLastCheckedTime(provider.lastCheckedAt)}</p>
                    <p className="text-slate-400 mt-1">点击重新检查</p>
                  </div>
                ) : (
                  <p>点击检查连接</p>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {props.onOpenSettings && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "relative p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg focus:outline-none transition-colors",
                  provider.preferences?.useBrowserRequest && "text-blue-600 dark:text-blue-400"
                )}
                title="提供商设置"
              >
                <MoreVertical className="w-4 h-4" />
                {provider.preferences?.useBrowserRequest && (
                  <div className="absolute top-1 right-1 w-1.5 h-1.5 bg-blue-500 rounded-full" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuLabel>提供商设置</DropdownMenuLabel>
              <DropdownMenuSeparator />

              {props.onResetUrl && (
                <DropdownMenuItem
                  title="恢复默认配置"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onResetUrl?.();
                  }}
                >
                  <Undo2 />
                  重置地址
                </DropdownMenuItem>
              )}

              <DropdownMenuItem
                title="请求方式等"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onOpenSettings?.();
                }}
              >
                <Sliders />
                高级选项
                {provider.preferences?.useBrowserRequest && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-500" />
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

export const ProviderHeader = React.memo(ProviderHeaderImpl, (prev, next) => {
  return (
    prev.provider.name === next.provider.name &&
    prev.provider.displayName === next.provider.displayName &&
    prev.resolvedIconSrc === next.resolvedIconSrc &&
    prev.isConnecting === next.isConnecting &&
    prev.isGloballyInitializing === next.isGloballyInitializing &&
    prev.provider.lastCheckedAt === next.provider.lastCheckedAt &&
    (prev.provider.preferences?.useBrowserRequest ?? false) === (next.provider.preferences?.useBrowserRequest ?? false) &&
    prev.hasFetchRule === next.hasFetchRule
  );
});
