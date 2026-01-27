"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderPlus, Trash2 } from "lucide-react";

import { SettingsCard } from "./SettingsCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { useFileSystemAuthStore, type AuthorizedDirectory } from "@/store/fileSystemAuthStore";
import { cn } from "@/lib/utils";

function normalizeAlias(input: string): string {
  return input.trim().replace(/^@/, "").replace(/\s+/g, "");
}

export function FileSystemAuthSettings() {
  const { directories, load, addDirectory, removeDirectory, updateDirectory } = useFileSystemAuthStore();
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

      const rawAlias = window.prompt("为该目录设置一个别名（将以 @别名/... 形式使用）", "ProjectDocs");
      if (!rawAlias) return;
      const alias = normalizeAlias(rawAlias);
      if (!alias) return;

      await addDirectory({
        path: selected,
        alias,
        permissions: { read: true, write: true, create: true, delete: false },
      });
    } finally {
      setLoading(false);
    }
  }, [addDirectory]);

  const list = useMemo(() => directories, [directories]);

  return (
    <SettingsCard>
      <SettingsSectionHeader icon={FolderPlus} title="授权目录（user_fs）" iconBgColor="from-emerald-500 to-teal-500" />

      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        这里管理“用户主动授权”的目录。LLM 只能通过 <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">user_fs</code>{" "}
        工具访问这些目录，并使用 <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">@别名/路径</code> 的形式定位文件。
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
        <div className="text-xs text-slate-500 dark:text-slate-400">已授权 {list.length} 个目录</div>
      </div>

      <div className="mt-4 space-y-3">
        {list.length === 0 ? (
          <div className="text-sm text-slate-500 dark:text-slate-400">暂无授权目录。点击“添加目录”开始。</div>
        ) : (
          list.map((d: AuthorizedDirectory) => (
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
                    @{d.alias}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300 break-all">{d.path}</div>
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
                    onClick={() =>
                      updateDirectory(d.id, {
                        permissions: { ...d.permissions, write: !d.permissions.write, create: !d.permissions.create },
                      })
                    }
                    className="text-xs rounded-lg border border-slate-200/70 dark:border-slate-700/60 px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    切换写入
                  </button>
                  <button
                    onClick={() => void removeDirectory(d.id)}
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

