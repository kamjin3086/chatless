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

interface AdvancedSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: ProviderWithStatus;
  onPreferenceChange?: (providerName: string, preferences: { useBrowserRequest?: boolean }) => Promise<void>;
}

// 策略选项
const STRATEGY_OPTIONS: { value: ToolCallStrategy; label: string; description: string; icon: React.ReactNode }[] = [
  {
    value: 'auto',
    label: '自动',
    description: '根据能力自动选择',
    icon: <Settings2 className="w-3.5 h-3.5" />,
  },
  {
    value: 'native',
    label: '原生API',
    description: '使用 tools 参数',
    icon: <Zap className="w-3.5 h-3.5" />,
  },
  {
    value: 'prompt',
    label: '提示词',
    description: '注入到 System Prompt',
    icon: <MessageSquare className="w-3.5 h-3.5" />,
  },
  {
    value: 'disabled',
    label: '禁用',
    description: '不使用工具调用',
    icon: <Ban className="w-3.5 h-3.5" />,
  },
];

// 能力标签
function CapabilityBadge({ capability }: { capability: string }) {
  const styles: Record<string, string> = {
    native: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    prompt: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    experimental: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    none: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500',
  };
  const labels: Record<string, string> = {
    native: '原生支持',
    prompt: '提示词模式',
    experimental: '实验性',
    none: '不支持',
  };
  return (
    <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium', styles[capability] || styles.none)}>
      {labels[capability] || capability}
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
            <Globe className="w-5 h-5 text-blue-600" />
            {provider.name} - 高级设置
          </DialogTitle>
          <DialogDescription>
            配置网络请求方式和其他高级选项
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* 浏览器请求模式设置 */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium">浏览器请求模式</h3>
                  {isUpdating && (
                    <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  默认请求方式已适合大多数情况，如遇网络问题可尝试此模式
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
                    <div className="font-medium mb-1">注意事项：</div>
                    <ul className="space-y-0.5 text-amber-600 dark:text-amber-400">
                      <li>• 不支持跨域受限的API接口</li>
                      <li>• 某些代理设置可能不生效</li>
                      <li>• 建议仅在网络异常时启用</li>
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
                  <Wrench className="w-4 h-4 text-blue-600" />
                  <h3 className="text-sm font-medium">工具调用策略</h3>
                </div>
                <CapabilityBadge capability={providerConfig.defaultCapability} />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {providerConfig.note || `${provider.name} 默认使用${providerConfig.defaultCapability === 'native' ? '原生' : '提示词'}工具调用`}
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
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    )}
                  >
                    <span
                      className={cn(
                        'p-1.5 rounded mb-1',
                        effectiveStrategy === option.value
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
                      )}
                    >
                      {option.icon}
                    </span>
                    <span className="text-[11px] font-medium">{option.label}</span>
                  </button>
                ))}
              </div>
            )}

            {/* 覆盖提示 */}
            {hasOverride && (
              <div className="flex items-center justify-between p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400">
                  <Info className="w-3.5 h-3.5" />
                  <span>已覆盖默认策略</span>
                </div>
                <button
                  onClick={() => removeProviderOverride(providerId)}
                  className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
                >
                  <RotateCcw className="w-3 h-3" />
                  重置
                </button>
              </div>
            )}

            {/* 功能说明 */}
            <div className="text-[10px] text-gray-400 dark:text-gray-500 space-y-1">
              <p>• <strong>原生API</strong>：通过 API 的 tools 参数传递工具定义，更稳定</p>
              <p>• <strong>提示词</strong>：在 System Prompt 中注入工具描述，兼容性更广</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
