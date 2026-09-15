"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderDown, Trash2, HardDrive, ChevronDown, Check } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";

import { SettingsCard } from "./SettingsCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";
import { useConversationAttachmentStore } from "@/store/conversationAttachmentStore";
import { toast } from "@/components/ui/sonner";
import { copyDirectoryRecursive, ensureConversationWorkspace, removeConversationWorkspace, clearAllWorkspaces } from "@/lib/agentWorkspace/workspaceService";

function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 格式化会话标题
function formatConversationTitle(title: string, maxLen = 24): string {
  if (!title) return '未命名会话';
  return title.length > maxLen ? title.slice(0, maxLen) + '...' : title;
}

export function WorkspaceSettings() {
  const conversations = useChatStore((s) => s.conversations);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const clearWorkingDir = useConversationAttachmentStore((s) => s.clearWorkingDir);

  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDropdown, setShowDropdown] = useState(false);

  // 当前会话信息
  const currentConversation = useMemo(() => {
    return conversations.find(c => c.id === currentConversationId);
  }, [conversations, currentConversationId]);

  // 确保当前会话工作区存在
  useEffect(() => {
    if (!currentConversationId) return;
    void (async () => {
      try {
        const ws = await ensureConversationWorkspace(currentConversationId);
        useConversationAttachmentStore.getState().setWorkingDir(currentConversationId, ws.root);
      } catch {
        // ignore
      }
    })();
  }, [currentConversationId]);

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

      const { mkdir } = await import("@tauri-apps/plugin-fs");
      const normalized = selected.replace(/\\/g, "/");
      const baseExportDir = `${normalized}/Chatless-Export/${todayStamp()}`;
      
      let totalFiles = 0;
      for (const id of ids) {
        const ws = await ensureConversationWorkspace(id);
        const conv = conversations.find(c => c.id === id);
        // 使用会话标题作为导出文件夹名
        const safeName = (conv?.title || id).replace(/[<>:"/\\|?*]/g, '_').slice(0, 50);
        const dest = `${baseExportDir}/${safeName}`;
        
        await mkdir(dest, { recursive: true });
        const r = await copyDirectoryRecursive(ws.outDir, dest);
        totalFiles += r.filesCopied;
      }
      
      toast.success(`导出完成：${ids.length} 个会话，${totalFiles} 个文件`);
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
    
    setLoading(true);
    try {
      for (const id of ids) {
        await removeConversationWorkspace(id);
        clearWorkingDir(id);
      }
      toast.success(`已清理 ${ids.length} 个会话的工作区`);
      setSelectedIds(new Set());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`清理失败：${msg}`);
    } finally {
      setLoading(false);
    }
  }, [selectedIds, currentConversationId, clearWorkingDir]);

  // 清理全部工作区
  const onClearAll = useCallback(async () => {
    if (!window.confirm("确定要清理全部工作区吗？此操作不可撤销。")) return;
    
    setLoading(true);
    try {
      await clearAllWorkspaces();
      // 清空会话级 workingDir
      try {
        const st = useConversationAttachmentStore.getState();
        const map = (st as any).workingDirByConversation || {};
        for (const cid of Object.keys(map)) st.clearWorkingDir(cid);
      } catch {
        // ignore
      }
      toast.success("已清理全部工作区");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`清理失败：${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

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
        AI产物保存在应用专用区域。选择会话后可导出或清理。
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
              disabled={loading}
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
          disabled={loading}
        >
          <Trash2 className="h-3.5 w-3.5" />
          清理全部工作区
        </Button>
      </div>
    </SettingsCard>
  );
}
