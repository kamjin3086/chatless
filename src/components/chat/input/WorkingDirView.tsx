"use client";

import React from "react";
import { Folder, ExternalLink, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";

interface WorkingDirViewProps {
  workingDir: string;
  onRemove: () => void;
  className?: string;
}

export function WorkingDirView({ workingDir, onRemove, className }: WorkingDirViewProps) {
  const openDir = async () => {
    try {
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(workingDir);
    } catch (e) {
      toast.error("打开目录失败", { description: String(e) });
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg",
        "bg-slate-50 dark:bg-slate-800/50",
        "border border-slate-200 dark:border-slate-700",
        className
      )}
    >
      <Folder className="w-4 h-4 text-emerald-500 shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-slate-500 dark:text-slate-400">工作目录（@WorkDir）</div>
        <div className="text-sm text-slate-700 dark:text-slate-200 truncate" title={workingDir}>
          {workingDir}
        </div>
      </div>

      <button
        onClick={(e) => {
          // 防止被上层“整行可点击”容器误触发（例如同时弹出目录选择器）
          e.preventDefault();
          e.stopPropagation();
          void openDir();
        }}
        className="shrink-0 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        title="打开目录"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </button>

      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove();
        }}
        className="shrink-0 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        title="移除工作目录"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

