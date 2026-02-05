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
import { SYNC_DATA_TYPE_INFO } from "@/lib/sync/core/types";
import { cn } from "@/lib/utils";

/** 连接状态圆点组件 */
function ConnectionStatusDot({ status }: { status: ConnectionStatus }) {
  const statusConfig = {
    unknown: { color: "bg-gray-400", text: "未检测" },
    checking: { color: "bg-yellow-500 animate-pulse", text: "检测中..." },
    connected: { color: "bg-green-500", text: "已连接" },
    error: { color: "bg-red-500", text: "连接失败" },
  };

  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("w-2 h-2 rounded-full", config.color)} />
      <span className="text-xs text-slate-500 dark:text-slate-400">{config.text}</span>
    </div>
  );
}

/** 格式化时间显示 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "刚刚";
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 7) return `${diffDays} 天前`;
  
  return date.toLocaleDateString();
}

export function WebDavSyncSettings() {
  const cfg = useWebDavSyncStore();

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

  /** 获取启用的数据类型标签 */
  const enabledTypesLabel = useMemo(() => {
    if (cfg.enabledDataTypes.length === 0) return '未选择';
    if (cfg.enabledDataTypes.length === ALL_SYNC_DATA_TYPES.length) return '全部';
    return cfg.enabledDataTypes
      .map(t => SYNC_DATA_TYPE_INFO[t]?.label || t)
      .join('、');
  }, [cfg.enabledDataTypes]);

  return (
    <div className="space-y-4">
      <SettingsPageHeader
        title="同步设置"
        description="使用 WebDAV 在多设备间同步提示词、技能配置、Provider 设置等数据"
      />

      <SettingsCard>
        <div className="flex items-center justify-between mb-3">
          <SettingsSectionHeader icon={Cloud} title="WebDAV 同步" />
          {cfg.enabled && <ConnectionStatusDot status={cfg.connectionStatus} />}
        </div>

        <div className="space-y-2">
          <ToggleSwitch
            label="启用同步"
            checked={cfg.enabled}
            onChange={(v) => cfg.setConfig({ enabled: v })}
          />

          {cfg.enabled && (
            <>
              <ToggleSwitch
                label="自动同步"
                checked={cfg.autoSync}
                onChange={(v) => cfg.setConfig({ autoSync: v })}
                tooltip="数据变化后自动同步（5秒延迟）"
              />

              {/* 数据类型选择 */}
              <Collapsible open={dataTypesOpen} onOpenChange={setDataTypesOpen} className="pt-2">
                <CollapsibleTrigger className="flex items-center justify-between w-full text-sm">
                  <div className="flex items-center gap-1.5">
                    <Database className="w-4 h-4 text-slate-400" />
                    <span>同步内容</span>
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
                      const info = SYNC_DATA_TYPE_INFO[type];
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
                              {info?.label || type}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {info?.description}
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
                label="WebDAV URL"
                value={cfg.url}
                onChange={(e) => cfg.setConfig({ url: e.target.value })}
                placeholder="https://example.com/dav/files/user/"
                icon={<Link2 className="w-4 h-4 text-gray-400" />}
                tooltip="WebDAV 服务器地址，建议以 / 结尾"
              />

              <InputField
                label="远端目录"
                value={cfg.basePath}
                onChange={(e) => cfg.setConfig({ basePath: e.target.value })}
                placeholder="chatless"
                icon={<Folder className="w-4 h-4 text-gray-400" />}
                tooltip="数据存储的子目录名称"
              />

              <InputField
                label="用户名"
                value={cfg.username}
                onChange={(e) => cfg.setConfig({ username: e.target.value })}
                placeholder="username"
                icon={<User className="w-4 h-4 text-gray-400" />}
              />

              <InputField
                label="密码"
                type="password"
                value={cfg.password}
                onChange={(e) => cfg.setConfig({ password: e.target.value })}
                placeholder="••••••••"
                icon={<KeyRound className="w-4 h-4 text-gray-400" />}
              />

              <div className="flex items-center gap-2 pt-3">
                <Button
                  size="sm"
                  disabled={!canRun || syncing}
                  onClick={onSync}
                >
                  <RefreshCw className={cn("w-4 h-4 mr-1.5", syncing && "animate-spin")} />
                  {syncing ? "同步中..." : "立即同步"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={cfg.connectionStatus === 'checking'}
                  onClick={() => cfg.checkConnection()}
                >
                  检测连接
                </Button>
              </div>

              {/* 最近同步状态 */}
              {(cfg.lastSyncAt || cfg.lastError) && (
                <div className="mt-3 text-xs">
                  {cfg.lastSyncAt && !cfg.lastError && (
                    <div className="text-slate-500 dark:text-slate-400">
                      上次同步：{cfg.lastSyncSummary}（{formatTime(cfg.lastSyncAt)}）
                    </div>
                  )}
                  {cfg.lastError && (
                    <div className="text-red-500 dark:text-red-400 line-clamp-2">
                      错误：{cfg.lastError}
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
                    <span>同步历史（{cfg.syncHistory.length}）</span>
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
                              <div>{entry.error ? `失败: ${entry.error}` : entry.summary}</div>
                              {entry.dataTypes && entry.dataTypes.length > 0 && (
                                <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                                  {entry.dataTypes.map(t => SYNC_DATA_TYPE_INFO[t]?.label || t).join('、')}
                                </div>
                              )}
                            </div>
                            <span className="text-slate-400 dark:text-slate-500 whitespace-nowrap">
                              {formatTime(entry.timestamp)}
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
                        清除历史
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
