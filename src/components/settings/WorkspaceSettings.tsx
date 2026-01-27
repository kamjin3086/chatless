"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderDown, FolderPlus, Trash2 } from "lucide-react";

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

export function WorkspaceSettings() {
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const workDir = useConversationAttachmentStore(
    (s) => (currentConversationId ? s.getWorkingDir(currentConversationId) : undefined)
  );
  const clearWorkingDir = useConversationAttachmentStore((s) => s.clearWorkingDir);

  const [loading, setLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const workspaceRoot = useMemo(() => workDir || "", [workDir]);
  const outDir = useMemo(() => (workspaceRoot ? `${workspaceRoot.replace(/\\+/g, "/")}/out` : ""), [workspaceRoot]);

  // 确保当前会话工作区存在（避免设置页打开时 @WorkDir 为空）
  useEffect(() => {
    if (!currentConversationId) return;
    if (workspaceRoot) return;
    void (async () => {
      try {
        const ws = await ensureConversationWorkspace(currentConversationId);
        useConversationAttachmentStore.getState().setWorkingDir(currentConversationId, ws.root);
      } catch {
        // ignore
      } finally {
        setRefreshToken((x) => x + 1);
      }
    })();
  }, [currentConversationId]);

  const onExport = useCallback(async () => {
    if (!currentConversationId) {
      toast.error("未选择会话");
      return;
    }
    setLoading(true);
    try {
      const ws = await ensureConversationWorkspace(currentConversationId);

      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "选择导出目录（将把 out/ 导出到此目录）" });
      if (!selected || typeof selected !== "string") return;

      // 结构化目录：<selected>/Chatless/Outputs/<YYYY-MM-DD>/<conversationId>/
      const normalized = selected.replace(/\\/g, "/");
      const dest = `${normalized}/Chatless/Outputs/${todayStamp()}/${currentConversationId}`;

      const { mkdir } = await import("@tauri-apps/plugin-fs");
      await mkdir(dest, { recursive: true });

      const r = await copyDirectoryRecursive(ws.outDir, dest);
      toast.success(`导出完成：复制 ${r.filesCopied} 个文件到 ${dest}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`导出失败：${msg}`);
    } finally {
      setLoading(false);
    }
  }, [currentConversationId]);

  const onClearCurrent = useCallback(async () => {
    if (!currentConversationId) {
      toast.error("未选择会话");
      return;
    }
    setLoading(true);
    try {
      await removeConversationWorkspace(currentConversationId);
      clearWorkingDir(currentConversationId);
      toast.success("已清理当前会话工作区");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`清理失败：${msg}`);
    } finally {
      setLoading(false);
      setRefreshToken((x) => x + 1);
    }
  }, [clearWorkingDir, currentConversationId]);

  const onClearAll = useCallback(async () => {
    setLoading(true);
    try {
      await clearAllWorkspaces();
      // 清空会话级 workingDir（非持久化）
      try {
        const st = useConversationAttachmentStore.getState();
        const map = (st as any).workingDirByConversation || {};
        for (const cid of Object.keys(map)) st.clearWorkingDir(cid);
      } catch {
        // ignore
      }
      toast.success("已清理全部工作区（AppData/workspaces）");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`清理失败：${msg}`);
    } finally {
      setLoading(false);
      setRefreshToken((x) => x + 1);
    }
  }, []);

  return (
    <SettingsCard>
      <SettingsSectionHeader icon={FolderPlus} title="工作区与导出" iconBgColor="from-sky-500 to-indigo-500" />

      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        默认情况下，Agent 的脚本/中间文件/产物会写入 <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">@WorkDir</code>{" "}
        （应用 AppData 工作区），避免自动扩大到 Documents 等用户目录。只有当你点击“导出”并选择目录时，才会把 out/ 复制到你指定的位置。
      </p>

      <div className="mt-4 grid grid-cols-1 gap-2">
        <div className="text-xs text-slate-500 dark:text-slate-400">
          当前会话：<span className="font-mono">{currentConversationId || "(none)"}</span>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          @WorkDir：<span className="font-mono break-all">{workspaceRoot || "(初始化中...)"}</span>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          out/：<span className="font-mono break-all">{outDir || "(unknown)"}</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={onExport}
          disabled={loading || !currentConversationId}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium",
            "bg-indigo-600 text-white hover:bg-indigo-700 transition-colors",
            (loading || !currentConversationId) && "opacity-60 cursor-not-allowed"
          )}
        >
          <FolderDown className="h-4 w-4" />
          导出 out/ 到指定目录
        </button>

        <button
          onClick={onClearCurrent}
          disabled={loading || !currentConversationId}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium",
            "border border-slate-200/70 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors",
            (loading || !currentConversationId) && "opacity-60 cursor-not-allowed"
          )}
        >
          <Trash2 className="h-4 w-4" />
          清理当前会话工作区
        </button>

        <button
          onClick={onClearAll}
          disabled={loading}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium",
            "border border-red-200/70 dark:border-red-900/40 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors",
            loading && "opacity-60 cursor-not-allowed"
          )}
        >
          <Trash2 className="h-4 w-4" />
          清理全部工作区
        </button>
      </div>

      {/* 仅用于触发重渲染，避免 eslint 提示未使用 */}
      <span className="hidden">{refreshToken}</span>
    </SettingsCard>
  );
}

