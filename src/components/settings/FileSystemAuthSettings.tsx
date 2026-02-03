"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderPlus, Trash2, Edit2, Shield } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

import { SettingsCard } from "./SettingsCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { useFilesystemAllowlistStore } from "@/store/filesystemAllowlistStore";
import { ensureAllowlistedDirectory, normalizeAlias as normalizeAliasCore } from "@/lib/filesystemAllowlist";
import { syncFilesystemAllowlistToBackend } from "@/lib/filesystemAllowlist/backendSync";
import { cn } from "@/lib/utils";

function normalizeAlias(input: string): string {
  return normalizeAliasCore(input);
}

// 从路径中提取显示名称（仅显示最后一级目录名）
function getDisplayName(path: string, alias?: string): string {
  if (alias) return `@${alias}`;
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || '未知目录';
}

// 来源标签
function getSourceLabel(source: string): string {
  switch (source) {
    case 'manual': return '手动添加';
    case 'skills': return '技能';
    case 'attachment': return '附件';
    default: return '';
  }
}

export function FileSystemAuthSettings() {
  const { directories, load, removeDirectory, updateDirectory } = useFilesystemAllowlistStore();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const syncToBackend = useCallback(async () => {
    const dirs = useFilesystemAllowlistStore.getState().directories;
    await syncFilesystemAllowlistToBackend(dirs);
  }, []);

  const onAdd = useCallback(async () => {
    setLoading(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (!selected || typeof selected !== "string") return;

      const rawAlias = window.prompt("为该目录设置一个别名（推荐设置，便于识别）", "");
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

  // 过滤掉工作目录来源的条目（工作目录默认被授权，无需显示）
  const filteredDirs = useMemo(() => {
    return directories.filter(d => d.source !== 'workdir');
  }, [directories]);

  const permLabel = (v: boolean) => v ? "✓" : "–";

  return (
    <SettingsCard>
      <SettingsSectionHeader icon={Shield} title="文件访问白名单" />

      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
        管理允许AI访问的目录。建议为每个目录设置易识别的别名。
      </p>

      {/* 顶部工具栏 */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          onClick={onAdd}
          disabled={loading}
          className={cn(
            "h-7 px-2 text-xs rounded flex items-center gap-1",
            "bg-emerald-600 text-white hover:bg-emerald-700 transition-colors",
            loading && "opacity-60 cursor-not-allowed"
          )}
        >
          <FolderPlus className="h-3.5 w-3.5" />
          添加目录
        </button>
        <span className="text-[11px] text-slate-400">{filteredDirs.length} 个</span>
      </div>

      {/* 目录列表 */}
      <div className="mt-3 border border-slate-200/60 dark:border-slate-700/40 rounded-lg overflow-hidden">
        <ScrollArea className="h-[240px]">
          {filteredDirs.length === 0 ? (
            <div className="p-4 text-center text-[11px] text-slate-400">
              暂无白名单目录
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredDirs.map(d => (
                <div
                  key={d.id}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors group"
                >
                  {/* 主信息 */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={cn(
                        "text-xs font-medium truncate",
                        d.alias ? "text-emerald-600 dark:text-emerald-400" : "text-slate-700 dark:text-slate-200"
                      )}>
                        {getDisplayName(d.path, d.alias)}
                      </span>
                      {getSourceLabel(d.source) && (
                        <span className="text-[9px] px-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-400">
                          {getSourceLabel(d.source)}
                        </span>
                      )}
                    </div>
                    {/* 权限标签 */}
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={cn(
                        "text-[9px]",
                        d.permissions.read ? "text-emerald-500" : "text-slate-300"
                      )}>读{permLabel(d.permissions.read)}</span>
                      <span className={cn(
                        "text-[9px]",
                        d.permissions.write ? "text-blue-500" : "text-slate-300"
                      )}>写{permLabel(d.permissions.write)}</span>
                      <span className={cn(
                        "text-[9px]",
                        d.permissions.create ? "text-amber-500" : "text-slate-300"
                      )}>建{permLabel(d.permissions.create)}</span>
                      <span className={cn(
                        "text-[9px]",
                        d.permissions.delete ? "text-red-500" : "text-slate-300"
                      )}>删{permLabel(d.permissions.delete)}</span>
                    </div>
                  </div>
                  
                  {/* 操作按钮 */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={async () => {
                        const raw = window.prompt("设置别名（便于识别）", d.alias || "");
                        if (raw === null) return;
                        await updateDirectory(d.id, { alias: raw.trim() ? normalizeAlias(raw) : "" });
                        await syncToBackend();
                      }}
                      className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40"
                      title="编辑别名"
                    >
                      <Edit2 className="h-3 w-3" />
                    </button>
                    <button
                      onClick={async () => {
                        await updateDirectory(d.id, {
                          permissions: { ...d.permissions, write: !d.permissions.write, create: !d.permissions.create },
                        });
                        await syncToBackend();
                      }}
                      className={cn(
                        "h-6 px-1 text-[10px] rounded transition-colors",
                        d.permissions.write 
                          ? "text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20" 
                          : "text-slate-400 hover:bg-slate-100/60 dark:hover:bg-slate-800/40"
                      )}
                      title="切换写入权限"
                    >
                      写
                    </button>
                    <button
                      onClick={async () => {
                        await updateDirectory(d.id, {
                          permissions: { ...d.permissions, delete: !d.permissions.delete },
                        });
                        await syncToBackend();
                      }}
                      className={cn(
                        "h-6 px-1 text-[10px] rounded transition-colors",
                        d.permissions.delete 
                          ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" 
                          : "text-slate-400 hover:bg-slate-100/60 dark:hover:bg-slate-800/40"
                      )}
                      title="切换删除权限"
                    >
                      删
                    </button>
                    <button
                      onClick={async () => {
                        await removeDirectory(d.id);
                        await syncToBackend();
                      }}
                      className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                      title="移除"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </SettingsCard>
  );
}
