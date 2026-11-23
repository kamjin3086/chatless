"use client";

import { useId } from "react";
import { SettingsCard } from "./SettingsCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { ToggleSwitch } from "./ToggleSwitch";
import { Globe } from "lucide-react";
import { useNetworkPreferences } from '@/store/networkPreferences';
import { useTranslation } from '@/i18n/useTranslation';

export function NetworkSettings() {
  const { proxyUrl, useSystemProxy, offline, setProxyUrl, setUseSystemProxy, setOffline } = useNetworkPreferences();
  const t = useTranslation();
  const proxyId = useId();

  return (
    <SettingsCard>
      <SettingsSectionHeader icon={Globe} title={t('settings.network.title')} />
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <label htmlFor={proxyId} className="text-xs text-slate-700 dark:text-slate-300">
            {t('settings.network.proxyUrl')}
          </label>
          <input
            id={proxyId}
            type="text"
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            placeholder="http://127.0.0.1:7890"
            className="flex-1 max-w-xs h-7 px-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded-md bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-300"
          />
        </div>
        <ToggleSwitch
          label={t('settings.network.useSystemProxy')}
          checked={useSystemProxy}
          onChange={setUseSystemProxy}
        />
        <ToggleSwitch
          label={t('settings.network.offline')}
          checked={offline}
          onChange={setOffline}
          tooltip={t('settings.network.offlineHelp')}
        />
      </div>
    </SettingsCard>
  );
}
