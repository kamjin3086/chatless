"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderPlus, Trash2, Edit2, Shield } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";

import { SettingsCard } from "./SettingsCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { useFilesystemAllowlistStore } from "@/store/filesystemAllowlistStore";
import { useChatStore } from "@/store/chatStore";
import { ensureAllowlistedDirectory, normalizeAlias as normalizeAliasCore } from "@/lib/filesystemAllowlist";
import { syncFilesystemAllowlistToBackend } from "@/lib/filesystemAllowlist/backendSync";
import {
  clearConversationAccess,
  getConversationAccess,
  getGlobalAccess,
  setGlobalAccess,
  type AccessLevel,
} from "@/lib/mcp/accessPolicy";
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
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('ask');
  const conversationId = useChatStore((s) => s.currentConversationId);
  const [conversationOverride, setConversationOverride] = useState<AccessLevel | undefined>();

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void getGlobalAccess('fs').then(setAccessLevel);
  }, []);

  useEffect(() => {
    setConversationOverride(getConversationAccess('fs', conversationId || ''));
  }, [conversationId]);

  const onChangeAccessLevel = useCallback(async (level: AccessLevel) => {
    setAccessLevel(level);
    try {
      await setGlobalAccess('fs', level);
    } catch (error) {
      console.error('[FileSystemAuthSettings] 保存访问策略失败:', error);
      setAccessLevel(await getGlobalAccess('fs'));
    }
  }, []);

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

      {/* 访问策略：决定越权操作是否还要询问 */}
      <div className="mt-3 rounded-lg border border-slate-200/60 dark:border-slate-700/40 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-700 dark:text-slate-200">白名单之外的操作</div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {accessLevel === 'unrestricted'
                ? '不再询问，文件读写和删除直接执行（适合长时间自动任务）'
                : '弹卡片询问，可选仅本次 / 以后都允许 / 本会话不再询问'}
            </div>
          </div>
          <div className="shrink-0 flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
            {(['ask', 'unrestricted'] as const).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => void onChangeAccessLevel(level)}
                className={cn(
                  'px-2.5 py-1 text-[11px] transition-colors',
                  accessLevel === level
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
              >
                {level === 'ask' ? '每次询问' : '不再询问'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 会话级覆盖：卡片上选过“本会话不再询问”时显示，可一键恢复 */}
      {conversationOverride === 'unrestricted' && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-amber-300/60 dark:border-amber-700/50 bg-amber-50/60 dark:bg-amber-950/20 px-2.5 py-2">
          <span className="text-[11px] text-amber-700 dark:text-amber-300">
            当前会话已关闭文件操作询问
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => {
              clearConversationAccess('fs', conversationId || '');
              setConversationOverride(undefined);
            }}
          >
            恢复询问
          </Button>
        </div>
      )}

      {/* 顶部工具栏 */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2.5"
          onClick={onAdd}
          disabled={loading}
        >
          <FolderPlus className="h-3.5 w-3.5" />
          添加目录
        </Button>
        <span className="text-[11px] text-slate-400">{filteredDirs.length} 个</span>
      </div>

      {/* 目录列表 */}
      <div className="mt-3 border border-slate-200/60 dark:border-slate-700/40 rounded-lg overflow-hidden">
        <ScrollArea className={filteredDirs.length === 0 ? "h-[88px]" : "h-[200px]"}>
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
