"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SelectField } from "./SelectField";
import {
  getAuthorizationConfig,
  getServerConfig,
  setServerAutoAuthorize,
} from "@/lib/mcp/authorizationConfig";
import { SHELL_EXECUTOR_SERVER_NAME } from "@/lib/mcp/nativeTools/shellExecutor";

type Mode = "default" | "auto" | "manual";

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
  const [mode, setMode] = useState<Mode>("default");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await getAuthorizationConfig();
      setGlobalDefaultAuto(!!cfg.defaultAutoAuthorize);
      const sc = await getServerConfig(SHELL_EXECUTOR_SERVER_NAME);
      setMode(modeFromConfig(sc.autoAuthorize));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const defaultLabel = useMemo(
    () => (globalDefaultAuto ? "自动授权" : "每次确认"),
    [globalDefaultAuto]
  );

  const onChange = useCallback(async (next: Mode) => {
    setMode(next);
    await setServerAutoAuthorize(SHELL_EXECUTOR_SERVER_NAME, configValueFromMode(next));
  }, []);

  return (
    <div className={loading ? "opacity-70 pointer-events-none" : undefined}>
      <SelectField
        label="命令执行确认"
        tooltip="是否在运行命令前弹出确认。全局默认可在 MCP 高级设置中调整。"
        value={mode}
        onChange={(v) => void onChange(v as Mode)}
        options={[
          { value: "default", label: `跟随默认（${defaultLabel}）` },
          { value: "manual", label: "每次确认" },
          { value: "auto", label: "自动授权" },
        ]}
      />
    </div>
  );
}
