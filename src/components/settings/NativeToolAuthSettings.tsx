"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SelectField } from "./SelectField";
import { useTranslation } from "@/i18n/useTranslation";
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
  const t = useTranslation();

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
    () => (globalDefaultAuto ? t('settings.nativeToolAuth.autoAuthorize') : t('settings.nativeToolAuth.confirmEveryTime')),
    [globalDefaultAuto, t]
  );

  const onChange = useCallback(async (next: Mode) => {
    setMode(next);
    await setServerAutoAuthorize(SHELL_EXECUTOR_SERVER_NAME, configValueFromMode(next));
  }, []);

  return (
    <div className={loading ? "opacity-70 pointer-events-none" : undefined}>
      <SelectField
        label={t('settings.nativeToolAuth.label')}
        tooltip={t('settings.nativeToolAuth.tooltip')}
        value={mode}
        onChange={(v) => void onChange(v as Mode)}
        options={[
          { value: "default", label: t('settings.nativeToolAuth.followDefault').replace('{0}', defaultLabel) },
          { value: "manual", label: t('settings.nativeToolAuth.confirmEveryTime') },
          { value: "auto", label: t('settings.nativeToolAuth.autoAuthorize') },
        ]}
      />
    </div>
  );
}
