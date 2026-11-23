"use client";

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { 
  Globe, AlertTriangle, Loader2, Wrench, Zap, MessageSquare, Ban, Settings2, Info, RotateCcw
} from "lucide-react";
import type { ProviderWithStatus } from "@/hooks/useProviderManagement";
import { useToolCallPreferences } from "@/store/toolCallPreferences";
import { getProviderConfig, inferProviderId, type ToolCallStrategy } from "@/lib/llm/config/tool-call-config";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n/useTranslation";
import type { TranslationKey } from "@/i18n/types";

interface AdvancedSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: ProviderWithStatus;
  onPreferenceChange?: (providerName: string, preferences: { useBrowserRequest?: boolean }) => Promise<void>;
}

// 策略选项
const STRATEGY_OPTIONS: { value: ToolCallStrategy; labelKey: TranslationKey; icon: React.ReactNode }[] = [
  {
    value: 'auto',
    labelKey: 'settings.advancedProvider.strategy.auto',
    icon: <Settings2 className="w-3.5 h-3.5" />,
  },
  {
    value: 'native',
    labelKey: 'settings.advancedProvider.strategy.native',
    icon: <Zap className="w-3.5 h-3.5" />,
  },
  {
    value: 'prompt',
    labelKey: 'settings.advancedProvider.strategy.prompt',
    icon: <MessageSquare className="w-3.5 h-3.5" />,
  },
  {
    value: 'disabled',
    labelKey: 'settings.advancedProvider.strategy.disabled',
    icon: <Ban className="w-3.5 h-3.5" />,
  },
];

// 能力标签
function CapabilityBadge({ capability }: { capability: string }) {
  const t = useTranslation();
  const styles: Record<string, string> = {
    native: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    prompt: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    experimental: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
    none: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  };
  const labelKeys: Record<string, TranslationKey> = {
    native: 'settings.advancedProvider.capability.native',
    prompt: 'settings.advancedProvider.capability.prompt',
    experimental: 'settings.advancedProvider.capability.experimental',
    none: 'settings.advancedProvider.capability.none',
  };
  const labelKey = labelKeys[capability];
  return (
    <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium', styles[capability] || styles.none)}>
      {labelKey ? t(labelKey) : capability}
    </span>
  );
}

export function AdvancedSettingsDialog({
  open,
  onOpenChange,
  provider,
  onPreferenceChange,
}: AdvancedSettingsDialogProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [browserMode, setBrowserMode] = useState<boolean>(provider.preferences?.useBrowserRequest ?? false);
  const t = useTranslation();

  // 工具调用偏好
  const { 
    providerOverrides, 
    setProviderOverride, 
    removeProviderOverride,
    initialized: prefsInitialized 
  } = useToolCallPreferences();

  const providerId = inferProviderId(provider.name);
  const providerConfig = getProviderConfig(provider.name);
  const currentOverride = providerOverrides[providerId];
  const hasOverride = currentOverride?.enabled;
  const effectiveStrategy = hasOverride ? currentOverride.strategy : 'auto';

  useEffect(() => {
    if (open) {
      setBrowserMode(provider.preferences?.useBrowserRequest ?? false);
    }
  }, [open, provider.preferences?.useBrowserRequest]);

  const handleStrategyChange = (strategy: ToolCallStrategy) => {
    if (strategy === 'auto') {
      removeProviderOverride(providerId);
    } else {
      setProviderOverride(providerId, { strategy, enabled: true });
    }
  };

  const handleBrowserRequestToggle = async (checked: boolean) => {
    if (!onPreferenceChange || isUpdating) return;

    setIsUpdating(true);
    try {
      const repoName = provider.aliases?.[0] || provider.name;
      setBrowserMode(checked); // 先本地回显
      await onPreferenceChange(repoName, { useBrowserRequest: checked });
      // 不再在此处触发“立即检查”，避免弹窗被打断或列表刷新
      // 该偏好仅在发起网络请求时读取生效
    } catch (error) {
      console.error('Failed to update preference:', error);
      // 回滚本地显示
      setBrowserMode((prev)=>!prev);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-slate-500 dark:text-slate-400" />
            {t('settings.advancedProvider.title').replace('{name}', provider.name)}
          </DialogTitle>
          <DialogDescription>
            {t('settings.advancedProvider.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* 浏览器请求模式设置 */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('settings.advancedProvider.browserMode')}</h3>
                  {isUpdating && (
                    <Loader2 className="w-3 h-3 animate-spin text-sky-500" />
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('settings.advancedProvider.browserModeHint')}
                </p>
              </div>
              <Switch
                checked={browserMode}
                onCheckedChange={handleBrowserRequestToggle}
                disabled={isUpdating}
                size="md"
              />
            </div>

            {/* 跨域警告 - 仅在启用时显示 */}
            {provider.preferences?.useBrowserRequest && (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-amber-700 dark:text-amber-300">
                    <div className="font-medium mb-1">{t('settings.advancedProvider.warningTitle')}</div>
                    <ul className="space-y-0.5 text-amber-600 dark:text-amber-400">
                      <li>• {t('settings.advancedProvider.warningCors')}</li>
                      <li>• {t('settings.advancedProvider.warningProxy')}</li>
                      <li>• {t('settings.advancedProvider.warningWhenToEnable')}</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 工具调用策略设置 */}
          <div className="border-t pt-4 space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                  <h3 className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('settings.advancedProvider.toolCallStrategy')}</h3>
                </div>
                <CapabilityBadge capability={providerConfig.defaultCapability} />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {providerConfig.note || t('settings.advancedProvider.defaultNote')
                  .replace('{name}', provider.name)
                  .replace('{strategy}', providerConfig.defaultCapability === 'native' ? t('settings.advancedProvider.defaultStrategyNative') : t('settings.advancedProvider.defaultStrategyPrompt'))}
              </p>
            </div>

            {/* 策略选择器 */}
            {prefsInitialized && (
              <div className="grid grid-cols-4 gap-2">
                {STRATEGY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => handleStrategyChange(option.value)}
                    className={cn(
                      'flex flex-col items-center p-2 rounded-lg border text-center transition-all',
                      effectiveStrategy === option.value
                        ? 'glass-chip-active border-sky-400/60 bg-sky-50 dark:bg-sky-900/20'
                        : 'border-slate-300/80 dark:border-slate-600/60 bg-white/60 dark:bg-white/5 hover:border-slate-400/80 dark:hover:border-slate-500'
                    )}
                  >
                    <span
                      className={cn(
                        'p-1.5 rounded-md mb-1',
                        effectiveStrategy === option.value
                          ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                      )}
                    >
                      {option.icon}
                    </span>
                    <span className={cn(
                      'text-[11px] font-medium',
                      effectiveStrategy === option.value
                        ? 'text-sky-700 dark:text-sky-300'
                        : 'text-slate-600 dark:text-slate-300'
                    )}>{t(option.labelKey)}</span>
                  </button>
                ))}
              </div>
            )}

            {/* 覆盖提示 */}
            {hasOverride && (
              <div className="flex items-center justify-between p-2 rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-200/70 dark:border-sky-800/40">
                <div className="flex items-center gap-2 text-xs text-sky-700 dark:text-sky-300">
                  <Info className="w-3.5 h-3.5" />
                  <span>{t('settings.advancedProvider.overridden')}</span>
                </div>
                <button
                  onClick={() => removeProviderOverride(providerId)}
                  className="flex items-center gap-1 text-xs text-sky-600 hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-200"
                >
                  <RotateCcw className="w-3 h-3" />
                  {t('settings.advancedProvider.reset')}
                </button>
              </div>
            )}

            {/* 功能说明 */}
            <div className="text-[10px] text-slate-500 dark:text-slate-400 space-y-1">
              <p>• <strong>{t('settings.advancedProvider.strategy.native')}</strong>{t('settings.advancedProvider.noteNative')}</p>
              <p>• <strong>{t('settings.advancedProvider.strategy.prompt')}</strong>{t('settings.advancedProvider.notePrompt')}</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
