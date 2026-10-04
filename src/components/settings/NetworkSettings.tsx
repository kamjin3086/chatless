"use client";

import { SettingsCard } from "./SettingsCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { ToggleSwitch } from "./ToggleSwitch";
import { Globe } from "lucide-react";
import { useNetworkPreferences } from '@/store/networkPreferences';

export function NetworkSettings() {
  const { proxyUrl, useSystemProxy, offline, setProxyUrl, setUseSystemProxy, setOffline } = useNetworkPreferences();

  return (
    <SettingsCard>
      <SettingsSectionHeader icon={Globe} title="网络设置" />
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-slate-700 dark:text-slate-300">代理地址</span>
          <input
            type="text"
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            placeholder="http://127.0.0.1:7890"
            className="flex-1 max-w-xs h-7 px-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded-md bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-300"
          />
        </div>
        <ToggleSwitch
          label="使用系统代理"
          checked={useSystemProxy}
          onChange={setUseSystemProxy}
        />
        <ToggleSwitch
          label="离线模式"
          checked={offline}
          onChange={setOffline}
          tooltip="阻止网络请求，仅使用本地模型"
        />
      </div>
    </SettingsCard>
  );
}
