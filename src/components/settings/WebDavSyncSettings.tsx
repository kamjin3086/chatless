"use client";

import { useEffect, useMemo, useState } from "react";
import { Cloud, RefreshCw, Link2, Folder, User, KeyRound, ChevronDown, History, Database } from "lucide-react";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { InputField } from "./InputField";
import { ToggleSwitch } from "./ToggleSwitch";
import { SettingsCard, SettingsPageHeader } from "./SettingsCard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useWebDavSyncStore, ALL_SYNC_DATA_TYPES, type ConnectionStatus } from "@/store/webDavSyncStore";
import { translate } from "@/i18n";
import type { Locale, TranslationKey } from "@/i18n/types";
import { useLocaleStore } from "@/store/localeStore";
import { cn } from "@/lib/utils";
import {
  formatWebDavSyncDataTypes,
  formatWebDavSyncSummary,
  formatWebDavSyncText,
  formatWebDavSyncTime,
} from "./webDavSyncPresentation";

/** 连接状态圆点组件 */
function ConnectionStatusDot({ status, locale }: { status: ConnectionStatus; locale: Locale }) {
  const statusColors = {
    unknown: "bg-slate-400",
    checking: "bg-yellow-500 animate-pulse",
    connected: "bg-green-500",
    error: "bg-red-500",
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("w-2 h-2 rounded-full", statusColors[status])} />
      <span className="text-xs text-slate-500 dark:text-slate-400">
        {translate(locale, `settings.sync.connection.${status}`)}
      </span>
    </div>
  );
}

export function WebDavSyncSettings() {
  const cfg = useWebDavSyncStore();
  const locale = useLocaleStore((state) => state.locale);
  const t = (key: TranslationKey) => translate(locale, key);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [dataTypesOpen, setDataTypesOpen] = useState(false);

  // 进入页面时自动检测连接状态
  useEffect(() => {
    if (cfg.initialized && cfg.enabled && cfg.url && cfg.username && cfg.password) {
      cfg.checkConnection();
    }
  }, [cfg.initialized, cfg.enabled, cfg.url, cfg.username, cfg.password]);

  const canRun = useMemo(() => {
    if (!cfg.enabled) return false;
    if (!cfg.url.trim()) return false;
    if (!cfg.username.trim()) return false;
    if (!cfg.password.trim()) return false;
    if (cfg.enabledDataTypes.length === 0) return false;
    return true;
  }, [cfg.enabled, cfg.url, cfg.username, cfg.password, cfg.enabledDataTypes]);

  const syncing = cfg.syncStatus === 'syncing';

  const onSync = async () => {
    if (!canRun || syncing) return;
    await cfg.performSync('both');
  };

  const enabledTypesLabel = cfg.enabledDataTypes.length === 0
    ? t('settings.sync.dataTypes.none')
    : cfg.enabledDataTypes.length === ALL_SYNC_DATA_TYPES.length
      ? t('settings.sync.dataTypes.all')
      : formatWebDavSyncDataTypes(locale, cfg.enabledDataTypes);

  // History entries have their own timestamps; match the persisted summary instead.
  const lastSyncEntry = cfg.syncHistory.find((entry) => !entry.error && entry.summary === cfg.lastSyncSummary);
  const lastSyncSummary = lastSyncEntry ? formatWebDavSyncSummary(locale, lastSyncEntry) : cfg.lastSyncSummary;

  return (
    <div className="space-y-4">
      <SettingsPageHeader
        title={t('settings.sync.title')}
        description={t('settings.sync.description')}
      />

      <SettingsCard>
        <div className="flex items-center justify-between mb-3">
          <SettingsSectionHeader icon={Cloud} title={t('settings.sync.webdav')} />
          {cfg.enabled && <ConnectionStatusDot status={cfg.connectionStatus} locale={locale} />}
        </div>

        <div className="space-y-2">
          <ToggleSwitch
            label={t('settings.sync.enabled')}
            checked={cfg.enabled}
            onChange={(v) => cfg.setConfig({ enabled: v })}
          />

          {cfg.enabled && (
            <>
              <ToggleSwitch
                label={t('settings.sync.autoSync')}
                checked={cfg.autoSync}
                onChange={(v) => cfg.setConfig({ autoSync: v })}
                tooltip={t('settings.sync.autoSyncHelp')}
              />

              {/* 数据类型选择 */}
              <Collapsible open={dataTypesOpen} onOpenChange={setDataTypesOpen} className="pt-2">
                <CollapsibleTrigger className="flex items-center justify-between w-full text-sm">
                  <div className="flex items-center gap-1.5">
                    <Database className="w-4 h-4 text-slate-400" />
                    <span>{t('settings.sync.dataTypes')}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {enabledTypesLabel}
                    </span>
                    <ChevronDown className={cn(
                      "w-3.5 h-3.5 text-slate-400 transition-transform",
                      dataTypesOpen && "rotate-180"
                    )} />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <div className="space-y-2 pl-5">
                    {ALL_SYNC_DATA_TYPES.map((type) => {
                      const isChecked = cfg.enabledDataTypes.includes(type);
                      return (
                        <label
                          key={type}
                          className="flex items-start gap-2 cursor-pointer group"
                        >
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => cfg.toggleDataType(type)}
                            className="mt-0.5"
                          />
                          <div className="flex-1">
                            <div className="text-sm font-medium text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-slate-100">
                              {t(`settings.sync.dataTypes.${type}`)}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {t(`settings.sync.dataTypes.${type}Help`)}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <div className="pt-2 border-t border-slate-100/80 dark:border-slate-800/60" />

              <InputField
                label={t('settings.sync.url')}
                value={cfg.url}
                onChange={(e) => cfg.setConfig({ url: e.target.value })}
                placeholder="https://example.com/dav/files/user/"
                icon={<Link2 className="w-4 h-4 text-slate-400" />}
                tooltip={t('settings.sync.urlHelp')}
              />

              <InputField
                label={t('settings.sync.basePath')}
                value={cfg.basePath}
                onChange={(e) => cfg.setConfig({ basePath: e.target.value })}
                placeholder="chatless"
                icon={<Folder className="w-4 h-4 text-slate-400" />}
                tooltip={t('settings.sync.basePathHelp')}
              />

              <InputField
                label={t('settings.sync.username')}
                value={cfg.username}
                onChange={(e) => cfg.setConfig({ username: e.target.value })}
                placeholder={t('settings.sync.username')}
                icon={<User className="w-4 h-4 text-slate-400" />}
              />

              <InputField
                label={t('settings.sync.password')}
                type="password"
                value={cfg.password}
                onChange={(e) => cfg.setConfig({ password: e.target.value })}
                placeholder="••••••••"
                passwordVisibilityLabels={{
                  show: t('settings.sync.showPassword'),
                  hide: t('settings.sync.hidePassword'),
                }}
                icon={<KeyRound className="w-4 h-4 text-slate-400" />}
              />

              <div className="flex items-center gap-2 pt-3">
                <Button
                  size="sm"
                  disabled={!canRun || syncing}
                  onClick={onSync}
                >
                  <RefreshCw className={cn("w-4 h-4 mr-1.5", syncing && "animate-spin")} />
                  {t(syncing ? 'settings.sync.syncing' : 'settings.sync.syncNow')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={cfg.connectionStatus === 'checking'}
                  onClick={() => cfg.checkConnection()}
                >
                  {t('settings.sync.checkConnection')}
                </Button>
              </div>

              {/* 最近同步状态 */}
              {(cfg.lastSyncAt || cfg.lastError) && (
                <div className="mt-3 text-xs">
                  {cfg.lastSyncAt && !cfg.lastError && (
                    <div className="text-slate-500 dark:text-slate-400">
                      {formatWebDavSyncText(locale, lastSyncSummary ? 'settings.sync.lastSync' : 'settings.sync.lastSyncTime', {
                        summary: lastSyncSummary ?? '',
                        time: formatWebDavSyncTime(locale, cfg.lastSyncAt),
                      })}
                    </div>
                  )}
                  {cfg.lastError && (
                    <div className="text-red-500 dark:text-red-400 line-clamp-2">
                      {formatWebDavSyncText(locale, 'settings.sync.error', { detail: cfg.lastError })}
                    </div>
                  )}
                </div>
              )}

              {/* 同步历史折叠面板 */}
              {cfg.syncHistory.length > 0 && (
                <Collapsible open={historyOpen} onOpenChange={setHistoryOpen} className="mt-3">
                  <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300 transition-colors">
                    <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", historyOpen && "rotate-180")} />
                    <History className="w-3.5 h-3.5" />
                    <span>{formatWebDavSyncText(locale, 'settings.sync.history', { count: String(cfg.syncHistory.length) })}</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
                      {cfg.syncHistory.map((entry) => (
                        <div
                          key={entry.id}
                          className={cn(
                            "text-xs p-2 rounded-md",
                            entry.error
                              ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
                              : "bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300"
                          )}
                        >
                          <div className="flex justify-between items-start gap-2">
                            <div className="flex-1">
                              <div>{formatWebDavSyncSummary(locale, entry)}</div>
                              {entry.dataTypes && entry.dataTypes.length > 0 && (
                                <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                                  {formatWebDavSyncDataTypes(locale, entry.dataTypes)}
                                </div>
                              )}
                            </div>
                            <span className="text-slate-400 dark:text-slate-500 whitespace-nowrap">
                              {formatWebDavSyncTime(locale, entry.timestamp)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    {cfg.syncHistory.length > 0 && (
                      <button
                        onClick={() => cfg.clearSyncHistory()}
                        className="mt-2 text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                      >
                        {t('settings.sync.clearHistory')}
                      </button>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              )}
            </>
          )}
        </div>
      </SettingsCard>
    </div>
  );
}
