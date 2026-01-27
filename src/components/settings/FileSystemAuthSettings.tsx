"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderPlus, Trash2 } from "lucide-react";

import { SettingsCard } from "./SettingsCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { useFilesystemAllowlistStore } from "@/store/filesystemAllowlistStore";
import type { AllowlistDirectory } from "@/lib/filesystemAllowlist";
import { ensureAllowlistedDirectory, normalizeAlias as normalizeAliasCore } from "@/lib/filesystemAllowlist";
import { setFilesystemAllowedDirectories } from "@/lib/mcp/filesystemServerConfig";
import { cn } from "@/lib/utils";

function normalizeAlias(input: string): string {
  return normalizeAliasCore(input);
}

export function FileSystemAuthSettings() {
  const { directories, load, removeDirectory, updateDirectory } = useFilesystemAllowlistStore();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const syncToMcp = useCallback(async () => {
    const paths = useFilesystemAllowlistStore.getState().directories.map((d) => d.path);
    await setFilesystemAllowedDirectories({ directories: paths, reconnect: true });
  }, []);

  const onAdd = useCallback(async () => {
    setLoading(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (!selected || typeof selected !== "string") return;

      const rawAlias = window.prompt("为该目录设置一个别名（可选，将以 @别名/... 形式使用）", "ProjectDocs");
      const alias = rawAlias ? normalizeAlias(rawAlias) : undefined;

      await ensureAllowlistedDirectory({
        path: selected,
        alias: alias || undefined,
        source: "manual",
        permissions: { read: true, write: true, create: true, delete: false },
        reconnect: true,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const list = useMemo(() => directories, [directories]);

  const sourceLabel = useCallback((s: AllowlistDirectory["source"]) => {
    switch (s) {
      case "skills":
        return "skills";
      case "workdir":
        return "workdir";
      case "attachment":
        return "attachment";
      case "manual":
        return "manual";
      default:
        return "unknown";
    }
  }, []);

  return (
    <SettingsCard>
      <SettingsSectionHeader icon={FolderPlus} title="白名单目录（filesystem）" iconBgColor="from-emerald-500 to-teal-500" />

      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        这里管理 <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">filesystem</code> 的目录白名单（递归）。
        LLM 可使用绝对路径或 <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">@别名/路径</code> 访问；不在白名单内的路径会要求确认，确认后会加入白名单。
      </p>

      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          onClick={onAdd}
          disabled={loading}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium",
            "bg-emerald-600 text-white hover:bg-emerald-700 transition-colors",
            loading && "opacity-60 cursor-not-allowed"
          )}
        >
          <FolderPlus className="h-4 w-4" />
          添加目录
        </button>
        <div className="text-xs text-slate-500 dark:text-slate-400">已加入白名单 {list.length} 个目录</div>
      </div>

      <div className="mt-4 space-y-3">
        {list.length === 0 ? (
          <div className="text-sm text-slate-500 dark:text-slate-400">暂无白名单目录。点击“添加目录”开始。</div>
        ) : (
          list.map((d: AllowlistDirectory) => (
            <div
              key={d.id}
              className={cn(
                "rounded-xl border border-slate-200/70 dark:border-slate-700/60",
                "bg-white/60 dark:bg-slate-900/40 p-3"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {d.alias ? `@${d.alias}` : "（无别名）"}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300 break-all">{d.path}</div>
                  <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    source: <span className="font-mono">{sourceLabel(d.source)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                    <span className="rounded-md border border-slate-200/60 dark:border-slate-700/60 px-2 py-0.5">
                      read: {d.permissions.read ? "✓" : "✗"}
                    </span>
                    <span className="rounded-md border border-slate-200/60 dark:border-slate-700/60 px-2 py-0.5">
                      write: {d.permissions.write ? "✓" : "✗"}
                    </span>
                    <span className="rounded-md border border-slate-200/60 dark:border-slate-700/60 px-2 py-0.5">
                      create: {d.permissions.create ? "✓" : "✗"}
                    </span>
                    <span className="rounded-md border border-slate-200/60 dark:border-slate-700/60 px-2 py-0.5">
                      delete: {d.permissions.delete ? "✓" : "✗"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      const raw = window.prompt("修改别名（可留空表示不设置别名）", d.alias || "");
                      if (raw === null) return;
                      const nextAlias = raw.trim() ? normalizeAlias(raw) : "";
                      await updateDirectory(d.id, { alias: nextAlias });
                      await syncToMcp();
                    }}
                    className="text-xs rounded-lg border border-slate-200/70 dark:border-slate-700/60 px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    别名
                  </button>
                  <button
                    onClick={async () => {
                      await updateDirectory(d.id, {
                        permissions: { ...d.permissions, write: !d.permissions.write, create: !d.permissions.create },
                      });
                      await syncToMcp();
                    }}
                    className="text-xs rounded-lg border border-slate-200/70 dark:border-slate-700/60 px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    切换写入
                  </button>
                  <button
                    onClick={async () => {
                      await updateDirectory(d.id, {
                        permissions: { ...d.permissions, delete: !d.permissions.delete },
                      });
                      await syncToMcp();
                    }}
                    className="text-xs rounded-lg border border-slate-200/70 dark:border-slate-700/60 px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    切换删除
                  </button>
                  <button
                    onClick={async () => {
                      await removeDirectory(d.id);
                      await syncToMcp();
                    }}
                    className="inline-flex items-center gap-1 text-xs rounded-lg border border-red-200/70 dark:border-red-900/40 px-2 py-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    移除
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </SettingsCard>
  );
}

