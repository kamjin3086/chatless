"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TerminalSquare, Trash2, FolderPlus, Clock } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";

import { SettingsCard } from "./SettingsCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { NativeToolAuthSettings } from "./NativeToolAuthSettings";
import { cn } from "@/lib/utils";
import { useShellAuthStore, type CleanupDays } from "@/store/shellAuthStore";

function getDisplayName(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || "目录";
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));

  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return `${days}天前`;
  if (days < 30) return `${Math.floor(days / 7)}周前`;
  return `${Math.floor(days / 30)}月前`;
}

function isExpiringSoon(timestamp: number, cleanupDays: CleanupDays): boolean {
  if (cleanupDays === 0) return false;
  const now = Date.now();
  const expiryTime = timestamp + cleanupDays * 24 * 60 * 60 * 1000;
  const daysUntilExpiry = (expiryTime - now) / (24 * 60 * 60 * 1000);
  return daysUntilExpiry <= 7 && daysUntilExpiry > 0;
}

const selectClass =
  "h-7 px-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded-md bg-white/70 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-300 dark:focus:ring-slate-600";

export function ShellAuthSettings() {
  const { trustedWorkingDirs, cleanupDays, load, addTrustedWorkingDir, removeTrustedWorkingDir, setCleanupDays } =
    useShellAuthStore();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const onAdd = useCallback(async () => {
    setLoading(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (!selected || typeof selected !== "string") return;
      await addTrustedWorkingDir(selected);
    } finally {
      setLoading(false);
    }
  }, [addTrustedWorkingDir]);

  const sortedDirs = useMemo(() => {
    return [...trustedWorkingDirs].sort((a, b) => b.authorizedAt - a.authorizedAt).slice(0, 100);
  }, [trustedWorkingDirs]);

  return (
    <SettingsCard>
      <SettingsSectionHeader icon={TerminalSquare} title="命令执行" />

      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mb-3">
        配置命令是否需要确认，并管理免重复确认的目录。
      </p>

      <NativeToolAuthSettings />

      <div className="mt-4 pt-3 border-t border-slate-200/50 dark:border-slate-700/30">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onAdd} disabled={loading} className="h-7 px-2.5">
              <FolderPlus className="h-3.5 w-3.5" />
              添加目录
            </Button>
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              <select
                value={cleanupDays}
                onChange={(e) => setCleanupDays(Number(e.target.value) as CleanupDays)}
                className={selectClass}
                title="自动清理"
                aria-label="授权目录自动清理周期"
              >
                <option value={0}>不清理</option>
                <option value={30}>30 天</option>
                <option value={90}>90 天</option>
                <option value={180}>180 天</option>
              </select>
            </div>
          </div>
          <span className="text-[11px] text-slate-400">{sortedDirs.length} 个</span>
        </div>

        <div className="mt-3 border border-slate-200/60 dark:border-slate-700/40 rounded-lg overflow-hidden">
          <ScrollArea className={sortedDirs.length === 0 ? "h-[88px]" : "h-[160px]"}>
            {sortedDirs.length === 0 ? (
              <div className="h-full flex items-center justify-center text-[11px] text-slate-400">暂无授权目录</div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {sortedDirs.map((d) => {
                  const expiring = isExpiringSoon(d.authorizedAt, cleanupDays);
                  return (
                    <div
                      key={d.id}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-slate-700 dark:text-slate-200 truncate">
                            {getDisplayName(d.path)}
                          </span>
                          <span className={cn("text-[10px]", expiring ? "text-amber-500" : "text-slate-400")}>
                            {formatRelativeTime(d.authorizedAt)}
                          </span>
                          {expiring && (
                            <span className="text-[9px] px-1 rounded bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400">
                              即将过期
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => void removeTrustedWorkingDir(d.id)}
                        className="w-5 h-5 rounded flex items-center justify-center text-slate-400 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                        title="移除"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    </SettingsCard>
  );
}
