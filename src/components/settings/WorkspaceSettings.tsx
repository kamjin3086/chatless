"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderDown, FolderOpen, Trash2, HardDrive, ChevronDown, Check } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";

import { SettingsCard } from "./SettingsCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";
import { useConversationAttachmentStore } from "@/store/conversationAttachmentStore";
import { toast } from "@/components/ui/sonner";
import {
  ensureConversationWorkspace,
  exportConversationWorkspace,
  revealConversationWorkspace,
  trashConversationWorkspaces,
  trashEveryConversationWorkspace,
} from "@/lib/agentWorkspace/workspaceService";

function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// 格式化会话标题
function formatConversationTitle(title: string, maxLen = 24): string {
  if (!title) return '未命名会话';
  return title.length > maxLen ? title.slice(0, maxLen) + '...' : title;
}

export function WorkspaceSettings() {
  const conversations = useChatStore((s) => s.conversations);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const isGenerating = useChatStore((s) => s.isGenerating);
  const agentRuns = useChatStore((s) => s.agentRuns);
  const clearWorkingDir = useConversationAttachmentStore((s) => s.clearWorkingDir);
  const clearMountedDir = useConversationAttachmentStore((s) => s.clearMountedDir);
  const clearWorkspaceError = useConversationAttachmentStore((s) => s.clearWorkspaceError);
  const workspaceErrors = useConversationAttachmentStore((s) => s.workspaceErrorByConversation);

  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDropdown, setShowDropdown] = useState(false);

  // 当前会话信息
  const currentConversation = useMemo(() => {
    return conversations.find(c => c.id === currentConversationId);
  }, [conversations, currentConversationId]);

  // 正在跑任务的会话不允许清理：目录可能正被 Agent 或它启动的进程使用。
  const runningConversationIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of Object.values(agentRuns || {})) {
      if (run?.running && run.conversationId) ids.add(run.conversationId);
    }
    if (isGenerating && currentConversationId) ids.add(currentConversationId);
    return ids;
  }, [agentRuns, isGenerating, currentConversationId]);

  // 确保当前会话工作区存在
  useEffect(() => {
    if (!currentConversationId) return;
    void (async () => {
      try {
        const ws = await ensureConversationWorkspace({
          conversationId: currentConversationId,
          title: conversations.find(c => c.id === currentConversationId)?.title,
          // 只看路径，不建目录：工作目录是这个会话真正用到文件时才出现的。
          materialize: false,
        });
        useConversationAttachmentStore.getState().setWorkingDir(currentConversationId, ws.root, ws.exists);
        clearWorkspaceError(currentConversationId);
      } catch (e) {
        useConversationAttachmentStore.getState().setWorkspaceError(
          currentConversationId,
          e instanceof Error ? e.message : String(e),
        );
      }
    })();
  }, [currentConversationId, conversations, clearWorkspaceError]);

  // 导出选中的会话
  const onExport = useCallback(async () => {
    const ids = selectedIds.size > 0 ? Array.from(selectedIds) : (currentConversationId ? [currentConversationId] : []);
    if (ids.length === 0) {
      toast.error("请选择要导出的会话");
      return;
    }
    
    setLoading(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "选择导出位置" });
      if (!selected || typeof selected !== "string") return;

      // 导出固定在会话自带的产物目录（用户附加的项目目录不属于"AI 产物"）。
      const baseExportDir = `${selected.replace(/\\/g, "/")}/Chatless-Export/${todayStamp()}`;

      let totalFiles = 0;
      let totalBytes = 0;
      const failures: string[] = [];
      for (const id of ids) {
        try {
          const result = await exportConversationWorkspace(id, baseExportDir);
          totalFiles += result.files;
          totalBytes += result.bytes;
        } catch (error) {
          const name = conversations.find(c => c.id === id)?.title || id;
          failures.push(`${name}：${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (failures.length > 0) {
        toast.error(`有 ${failures.length} 个会话导出失败`, { description: failures[0] });
      }
      if (totalFiles === 0 && failures.length === 0) {
        toast.info("没有需要导出的文件", {
          description: "这些会话还没有产生文件；工作目录在第一次用到文件或命令时才会创建。",
        });
      } else if (failures.length === 0) {
        toast.success(`导出完成：${totalFiles} 个文件（${formatBytes(totalBytes)}）`);
      }
      setSelectedIds(new Set());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`导出失败：${msg}`);
    } finally {
      setLoading(false);
    }
  }, [selectedIds, currentConversationId, conversations]);

  // 清理选中的会话工作区
  const onCleanSelected = useCallback(async () => {
    const ids = selectedIds.size > 0 ? Array.from(selectedIds) : (currentConversationId ? [currentConversationId] : []);
    if (ids.length === 0) {
      toast.error("请选择要清理的会话");
      return;
    }
    const blocked = ids.filter((id) => runningConversationIds.has(id));
    if (blocked.length > 0) {
      toast.error("这些会话正在运行，先停止再清理", {
        description: blocked.map((id) => conversations.find(c => c.id === id)?.title || id).join("、"),
      });
      return;
    }
    
    setLoading(true);
    try {
      const outcome = await trashConversationWorkspaces(ids, (id) => {
        // 只有真的移入回收站后才丢掉记录；失败时记录必须留着，才能重试。
        clearWorkingDir(id);
        clearMountedDir(id);
      });
      if (outcome.failed.length > 0) {
        toast.error(`${outcome.failed.length} 个工作区清理失败`, {
          description: outcome.failed[0].error,
        });
      }
      if (outcome.removed.length > 0) {
        toast.success(`已移入回收站：${outcome.removed.length} 个会话的工作区`);
      }
      setSelectedIds(new Set(outcome.failed.map((f) => f.conversationId)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`清理失败：${msg}`);
    } finally {
      setLoading(false);
    }
  }, [selectedIds, currentConversationId, clearWorkingDir, clearMountedDir, conversations, runningConversationIds]);

  // 清理全部工作区
  const onClearAll = useCallback(async () => {
    if (runningConversationIds.size > 0) {
      toast.error("有会话正在运行，先停止再清理全部工作区");
      return;
    }
    if (!window.confirm("确定要清理全部工作区吗？文件夹会被移入系统回收站。")) return;
    
    setLoading(true);
    try {
      const outcome = await trashEveryConversationWorkspace();
      for (const id of outcome.removed) {
        clearWorkingDir(id);
        clearMountedDir(id);
      }
      if (outcome.failed.length > 0) {
        toast.error(`${outcome.failed.length} 个工作区清理失败`, {
          description: outcome.failed[0].error,
        });
      } else {
        toast.success(`已清理全部工作区（${outcome.removed.length} 个，均在回收站）`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`清理失败：${msg}`);
    } finally {
      setLoading(false);
    }
  }, [clearWorkingDir, clearMountedDir, runningConversationIds]);

  // 在文件管理器中定位当前会话的工作目录
  const onReveal = useCallback(async () => {
    if (!currentConversationId) return;
    try {
      // Open what @WorkDir actually points at: an attached project folder wins
      // over the session's own output folder.
      const mounted = useConversationAttachmentStore.getState().getMountedDir(currentConversationId);
      if (mounted) {
        const { openCheckedPath } = await import('@/lib/filesystemAllowlist/openCheckedPath');
        if (await openCheckedPath(mounted)) return;
      }
      await revealConversationWorkspace(currentConversationId);
    } catch (e) {
      toast.error("打开工作目录失败", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }, [currentConversationId]);

  const onRetryWorkspace = useCallback(async () => {
    if (!currentConversationId) return;
    try {
      const ws = await ensureConversationWorkspace({
        conversationId: currentConversationId,
        title: conversations.find(c => c.id === currentConversationId)?.title,
        // 用户点"重试"就是明确要它现在就准备好。
        materialize: true,
      });
      useConversationAttachmentStore.getState().setWorkingDir(currentConversationId, ws.root, ws.exists);
      useConversationAttachmentStore.getState().markWorkspaceMaterialized(currentConversationId);
      clearWorkspaceError(currentConversationId);
      toast.success("工作目录已就绪", { description: ws.root });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      useConversationAttachmentStore.getState().setWorkspaceError(currentConversationId, msg);
      toast.error("仍然无法准备工作目录", { description: msg });
    }
  }, [currentConversationId, conversations, clearWorkspaceError]);

  // 切换选中状态
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // 全选/取消全选
  const toggleSelectAll = () => {
    if (selectedIds.size === conversations.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(conversations.map(c => c.id)));
    }
  };

  return (
    <SettingsCard>
      <SettingsSectionHeader icon={HardDrive} title="工作区管理" />

      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
        每个会话的工作目录是「文档/Chatless/&lt;标题&gt;-&lt;会话摘要&gt;」，Agent 的产物就落在那里。
        它在这个会话第一次真正用到文件或命令时才会创建，纯聊天不会留下空文件夹。
        导出只复制这个自带目录（附加的项目目录属于你，不会被打包）；清理是移入系统回收站。
      </p>

      {/* 当前会话显示 */}
      {currentConversation && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/40">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] text-slate-400">当前会话</div>
              <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
                {formatConversationTitle(currentConversation.title)}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5"
                onClick={onReveal}
                title="在文件管理器中打开这个会话的工作目录"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                打开目录
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5"
                onClick={onExport}
                disabled={loading}
              >
                <FolderDown className="h-3.5 w-3.5" />
                导出
              </Button>
            </div>
          </div>
          {currentConversationId && workspaceErrors[currentConversationId] && (
            <div className="mt-2 flex items-start justify-between gap-2 text-[11px] text-rose-600 dark:text-rose-400">
              <span className="min-w-0 flex-1 break-words">
                工作目录不可用：{workspaceErrors[currentConversationId]}
              </span>
              <button
                type="button"
                onClick={onRetryWorkspace}
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] underline hover:no-underline"
              >
                重试
              </button>
            </div>
          )}
        </div>
      )}

      {/* 会话选择器 */}
      <div className="mt-3">
        <div className="flex items-center justify-between mb-2">
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="h-7 px-2 text-xs rounded border border-slate-200/60 dark:border-slate-700/40 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1"
            >
              选择会话
              <ChevronDown className={cn("h-3 w-3 transition-transform", showDropdown && "rotate-180")} />
            </button>
            
            {showDropdown && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/40 rounded-lg shadow-lg z-10">
                <div className="p-1.5 border-b border-slate-100 dark:border-slate-700">
                  <button
                    onClick={toggleSelectAll}
                    className="w-full text-left px-2 py-1 text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 rounded transition-colors"
                  >
                    {selectedIds.size === conversations.length ? '取消全选' : '全选'}
                  </button>
                </div>
                <ScrollArea className="h-[200px]">
                  <div className="p-1.5">
                    {conversations.slice(0, 50).map(conv => (
                      <button
                        key={conv.id}
                        onClick={() => toggleSelect(conv.id)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700 rounded transition-colors"
                      >
                        <div className={cn(
                          "w-4 h-4 rounded border flex items-center justify-center flex-shrink-0",
                          selectedIds.has(conv.id)
                            ? "bg-slate-800 border-slate-800 dark:bg-slate-200 dark:border-slate-200"
                            : "border-slate-300 dark:border-slate-600"
                        )}>
                          {selectedIds.has(conv.id) && <Check className="h-3 w-3 text-white dark:text-slate-900" />}
                        </div>
                        <span className="text-xs text-slate-700 dark:text-slate-200 truncate flex-1">
                          {formatConversationTitle(conv.title, 32)}
                        </span>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
          
          {selectedIds.size > 0 && (
            <span className="text-[11px] text-slate-400">已选 {selectedIds.size} 个</span>
          )}
        </div>

        {/* 批量操作按钮 */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5"
              onClick={onExport}
              disabled={loading}
            >
              <FolderDown className="h-3.5 w-3.5" />
              导出选中
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5"
              onClick={onCleanSelected}
              disabled={loading || Array.from(selectedIds).some((id) => runningConversationIds.has(id))}
              title="移入系统回收站"
            >
              <Trash2 className="h-3.5 w-3.5" />
              清理选中
            </Button>
          </div>
        )}
      </div>

      {/* 危险操作区 */}
      <div className="mt-4 pt-3 border-t border-slate-200/50 dark:border-slate-700/30">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50/80 dark:text-rose-400 dark:hover:bg-rose-500/10"
          onClick={onClearAll}
          disabled={loading || runningConversationIds.size > 0}
        >
          <Trash2 className="h-3.5 w-3.5" />
          清理全部工作区
        </Button>
      </div>
    </SettingsCard>
  );
}
