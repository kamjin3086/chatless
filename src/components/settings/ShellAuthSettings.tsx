"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TerminalSquare, Trash2, FolderPlus } from "lucide-react";

import { SettingsCard } from "./SettingsCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { cn } from "@/lib/utils";
import { useShellAuthStore } from "@/store/shellAuthStore";

export function ShellAuthSettings() {
  const { trustedWorkingDirs, load, addTrustedWorkingDir, removeTrustedWorkingDir } = useShellAuthStore();
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

  const list = useMemo(() => trustedWorkingDirs, [trustedWorkingDirs]);

  return (
    <SettingsCard>
      <SettingsSectionHeader
        icon={TerminalSquare}
        title="命令执行：信任的工作目录"
        iconBgColor="from-blue-500 to-cyan-500"
      />

      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        这里用来减少“重复审批”的打扰：当 shell 命令在这些工作目录（及其子目录）下执行时，常见低风险命令会尽量不再反复弹确认。
        <br />
        <span className="text-xs text-slate-500 dark:text-slate-400">
          高风险命令（安装运行时/改环境变量/下载脚本执行等）仍会强制需要你确认。
        </span>
      </p>

      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          onClick={onAdd}
          disabled={loading}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium",
            "bg-blue-600 text-white hover:bg-blue-700 transition-colors",
            loading && "opacity-60 cursor-not-allowed"
          )}
        >
          <FolderPlus className="h-4 w-4" />
          添加工作目录
        </button>
        <div className="text-xs text-slate-500 dark:text-slate-400">已信任 {list.length} 个目录</div>
      </div>

      <div className="mt-4 space-y-3">
        {list.length === 0 ? (
          <div className="text-sm text-slate-500 dark:text-slate-400">暂无信任目录。你也可以在工具卡片审批后自动积累。</div>
        ) : (
          list.map((d) => (
            <div
              key={d.id}
              className={cn(
                "rounded-xl border border-slate-200/70 dark:border-slate-700/60",
                "bg-white/60 dark:bg-slate-900/40 p-3"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">工作目录</div>
                  <div className="text-xs text-slate-600 dark:text-slate-300 break-all">{d.path}</div>
                  <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                    子目录同样生效；仅对常见低风险命令免重复审批
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void removeTrustedWorkingDir(d.id)}
                    className="inline-flex items-center gap-1 text-xs rounded-lg border border-red-200/70 dark:border-red-900/40 px-2 py-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                    title="移除该目录"
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

