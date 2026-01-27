"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";

import { SettingsCard } from "./SettingsCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { cn } from "@/lib/utils";
import {
  getAuthorizationConfig,
  getServerConfig,
  setServerAutoAuthorize,
} from "@/lib/mcp/authorizationConfig";
import { SHELL_EXECUTOR_SERVER_NAME } from "@/lib/mcp/nativeTools/shellExecutor";

type Mode = "default" | "auto" | "manual";

type Row = {
  server: string;
  title: string;
  description: string;
};

const ROWS: Row[] = [
  {
    server: SHELL_EXECUTOR_SERVER_NAME,
    title: "命令执行（shell_executor）",
    description: "执行命令/脚本的能力，风险最高。建议保持“每次确认”。",
  },
];

function modeFromConfig(autoAuthorize: boolean | undefined): Mode {
  if (autoAuthorize === undefined) return "default";
  return autoAuthorize ? "auto" : "manual";
}

function configValueFromMode(mode: Mode): boolean | undefined {
  if (mode === "default") return undefined;
  return mode === "auto";
}

export function NativeToolAuthSettings() {
  const [loading, setLoading] = useState(true);
  const [globalDefaultAuto, setGlobalDefaultAuto] = useState(false);
  const [serverMode, setServerMode] = useState<Record<string, Mode>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await getAuthorizationConfig();
      setGlobalDefaultAuto(!!cfg.defaultAutoAuthorize);

      const entries = await Promise.all(
        ROWS.map(async (r) => {
          const sc = await getServerConfig(r.server);
          return [r.server, modeFromConfig(sc.autoAuthorize)] as const;
        })
      );
      setServerMode(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const defaultLabel = useMemo(() => (globalDefaultAuto ? "自动授权" : "每次确认"), [globalDefaultAuto]);

  const onChange = useCallback(async (server: string, mode: Mode) => {
    setServerMode((prev) => ({ ...prev, [server]: mode }));
    await setServerAutoAuthorize(server, configValueFromMode(mode));
  }, []);

  return (
    <SettingsCard>
      <SettingsSectionHeader
        icon={ShieldCheck}
        title="原生工具授权策略"
        iconBgColor="from-indigo-500 to-violet-500"
      />

      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        这里配置“是否自动授权”——影响工具卡片是否需要你点击“确认/取消”。全局默认当前为{" "}
        <span className="font-semibold text-slate-900 dark:text-slate-100">{defaultLabel}</span>（可在 MCP 服务器页的高级设置里调整）。
      </p>

      <div className={cn("mt-4 space-y-3", loading && "opacity-70 pointer-events-none")}>
        {ROWS.map((r) => {
          const mode = serverMode[r.server] ?? "default";
          return (
            <div
              key={r.server}
              className="rounded-xl border border-slate-200/70 dark:border-slate-700/60 bg-white/60 dark:bg-slate-900/40 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{r.title}</div>
                  <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{r.description}</div>
                  <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono">{r.server}</div>
                </div>

                <select
                  value={mode}
                  onChange={(e) => void onChange(r.server, e.target.value as Mode)}
                  className={cn(
                    "h-9 rounded-lg border px-2 text-sm bg-white/80 dark:bg-slate-950/40",
                    "border-slate-200/70 dark:border-slate-700/60 text-slate-900 dark:text-slate-100"
                  )}
                  aria-label={`授权策略：${r.server}`}
                >
                  <option value="default">使用默认（{defaultLabel}）</option>
                  <option value="manual">每次确认</option>
                  <option value="auto">自动授权</option>
                </select>
              </div>
            </div>
          );
        })}
      </div>
    </SettingsCard>
  );
}

