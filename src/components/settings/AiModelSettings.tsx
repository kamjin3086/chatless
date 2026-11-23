"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Image from "next/image";
import { DndContext, PointerSensor, useSensor, useSensors, DragStartEvent, DragEndEvent, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
// import { SettingsSectionHeader } from "./SettingsSectionHeader";
// import { ModelCard } from "./ModelCard"; // 不再使用 ModelCard
import { ProviderSettings } from "./ProviderSettings";
import { ServerCog, GripVertical, ChevronDown, ChevronLeft, ChevronRight, FileDown, RotateCcw } from "lucide-react";
import { useChatStore } from "@/store/chatStore";
import { specializedStorage } from "@/lib/storage";
import {
  providerStatusChip,
  sortProvidersForMobileList,
} from "@/lib/provider/providerListStatus";
// 导入新模块
/* Commenting out for now due to persistent linter error
import {
  getMergedMetadata,
  ProviderMetadata,
  ModelMetadata,
  updateProviderUrlOverride,
  updateProviderDefaultApiKeyOverride,
  updateModelApiKeyOverride,
  updateOllamaModelsCache,
*/
import { toast } from "@/components/ui/sonner";
// Input 移除，头部使用自定义 SearchInput
import { SearchInput } from "@/components/ui/SearchInput";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
// 不再需要直接导入 tauriFetch
// import { fetch as tauriFetch } from '@tauri-apps/plugin-http'; 
// import { useProviderStatusStore } from '@/store/providerStatusStore'; // <-- 已修改路径
// 导入新的 Hook 和类型
import { useProviderManagement, ProviderWithStatus } from '@/hooks/useProviderManagement';
import { cn } from "@/lib/utils"; // Assuming cn is used somewhere or will be
import { AddProvidersDialog } from './AddProvidersDialog';
import { formatProviderModelCount } from './providerModelPresentation';
import { exportAndroidLogs } from '@/lib/android/androidLogExport';
import { useTranslation } from '@/i18n/useTranslation';
import { useStableProviderIcon } from "./useStableProviderIcon";
import { getHtmlLang, translate } from '@/i18n';
import type { Locale, TranslationKey } from '@/i18n/types';
import { useLocaleStore } from '@/store/localeStore';
import { useSearchParams } from "next/navigation";
import { ContextMenu } from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
// 头部过滤器已内化到表头，无需 Select 组件
// duplicate import removed

function formatLastChecked(locale: Locale, timestamp?: number) {
  if (!timestamp) return translate(locale, 'provider.list.notCheckedYet');
  const diff = Date.now() - timestamp;
  if (diff < 60000) return translate(locale, 'provider.list.justChecked');
  const relativeTime = new Intl.RelativeTimeFormat(getHtmlLang(locale));
  if (diff < 3600000) return relativeTime.format(-Math.floor(diff / 60000), 'minute');
  if (diff < 86400000) return relativeTime.format(-Math.floor(diff / 3600000), 'hour');
  return relativeTime.format(-Math.floor(diff / 86400000), 'day');
}

interface SortableProviderRowProps {
  provider: ProviderWithStatus;
  isSelected: boolean;
  onSelect: (name: string) => void;
  onRefresh: (provider: ProviderWithStatus) => void;
}

const SortableProviderRow = React.memo(function SortableProviderRow({
  provider,
  isSelected,
  onSelect,
  onRefresh,
}: SortableProviderRowProps) {
  const locale = useLocaleStore((state) => state.locale);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: provider.name });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    willChange: isDragging ? 'transform' : undefined,
  };

  const { iconSrc } = useStableProviderIcon(provider as any);
  const needsKey = provider.configStatus === 'NO_KEY';

  const menuItems = useMemo(() => [
    {
      id: 'refresh',
      text: translate(locale, 'provider.list.refresh'),
      action: () => { onRefresh(provider); }
    },
    {
      id: 'copy-url',
      text: translate(locale, 'provider.list.copyUrl'),
      action: () => {
        const url = (provider as any).url || (provider as any).api_base_url || '';
        navigator.clipboard.writeText(url);
        toast.success(translate(locale, 'provider.list.urlCopied'), { duration: 2000 });
      }
    },
    {
      id: 'separator-1',
      text: '',
      separator: true
    },
    {
      id: 'toggle-visibility',
      text: provider.isVisible ? translate(locale, 'provider.list.hide') : translate(locale, 'provider.list.show'),
      action: async () => {
        try {
          const { providerRepository } = await import('@/lib/provider/ProviderRepository');
          await providerRepository.setVisibility(provider.name, !provider.isVisible);
          toast.success(provider.isVisible ? translate(locale, 'provider.list.hidden') : translate(locale, 'provider.list.shown'), { duration: 2000 });
        } catch (error) {
          console.error('切换可见性失败:', error);
          toast.error(translate(locale, 'provider.list.actionFailed'));
        }
      }
    }
  ], [locale, provider, onRefresh]);

  const modelCount = provider.models?.length || 0;
  const tooltipContent = [
    provider.displayName || provider.name,
    ...(needsKey ? [translate(locale, 'provider.connection.noKey')] : []),
    formatLastChecked(locale, provider.lastCheckedAt),
    translate(locale, modelCount === 1 ? 'provider.list.oneModel' : 'provider.list.modelCount')
      .replace('{0}', String(modelCount)),
  ].join('\n');

  return (
    <ContextMenu menuItems={menuItems}>
      <div ref={setNodeRef} style={style} title={tooltipContent}>
        <button
          type="button"
          onClick={() => onSelect(provider.name)}
          className={cn(
            "provider-row w-full h-9 flex items-center gap-2 pl-6 pr-2 rounded-md text-left relative group select-none",
            "transition-colors duration-150",
            isSelected
              ? "is-selected bg-slate-100 dark:bg-white/10 text-slate-800 dark:text-slate-100 font-medium"
              : needsKey
                ? "is-muted text-slate-400 dark:text-slate-500 hover:bg-slate-100/80 dark:hover:bg-white/[0.06] hover:text-slate-500 dark:hover:text-slate-400"
                : "text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-white/[0.06] hover:text-slate-800 dark:hover:text-slate-100"
          )}
        >
          <span
            className="absolute left-1 top-1/2 -translate-y-1/2 flex items-center justify-center w-4 h-4 text-slate-300 dark:text-slate-600 cursor-grab active:cursor-grabbing hover:text-slate-500 dark:hover:text-slate-400 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="w-3 h-3" />
          </span>

          <div className={cn("w-5 h-5 rounded-sm overflow-hidden flex-shrink-0", needsKey && !isSelected && "opacity-60")}>
            <Image
              src={iconSrc}
              alt={provider.displayName || provider.name}
              className="w-5 h-5 object-contain"
              draggable={false}
              width={20}
              height={20}
            />
          </div>

          <span className="flex-1 min-w-0 truncate text-sm leading-none">
            {provider.displayName || provider.name}
          </span>
        </button>
      </div>
    </ContextMenu>
  );
}, (prev, next) => (
  prev.isSelected === next.isSelected &&
  prev.onSelect === next.onSelect &&
  prev.onRefresh === next.onRefresh &&
  prev.provider.name === next.provider.name &&
  prev.provider.displayName === next.provider.displayName &&
  prev.provider.configStatus === next.provider.configStatus &&
  prev.provider.displayStatus === next.provider.displayStatus &&
  prev.provider.isVisible === next.provider.isVisible &&
  prev.provider.icon === next.provider.icon &&
  prev.provider.lastCheckedAt === next.provider.lastCheckedAt &&
  prev.provider.api_base_url === next.provider.api_base_url &&
  (prev.provider.models?.length ?? 0) === (next.provider.models?.length ?? 0)
));

export const MobileProviderRow = React.memo(function MobileProviderRow({
  provider,
  inUse,
  onOpen,
}: {
  provider: ProviderWithStatus;
  inUse: boolean;
  onOpen: () => void;
}) {
  const { iconSrc } = useStableProviderIcon(provider as any);
  const t = useTranslation();
  const status = providerStatusChip(provider);
  const modelCount = provider.models?.length ?? 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-start transition-colors active:bg-muted",
        inUse ? "border-blue-500/40 bg-blue-500/[0.06]" : "border-border bg-background",
      )}
    >
      <Image
        src={iconSrc}
        alt=""
        width={28}
        height={28}
        className="size-7 shrink-0 object-contain"
        draggable={false}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">
            {provider.displayName || provider.name}
          </span>
          {inUse && (
            <span className="shrink-0 rounded-md bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-600 dark:text-blue-300">
              {t('androidChat.inUse')}
            </span>
          )}
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-xs">
          <span className={cn("size-1.5 shrink-0 rounded-full", status.dot)} />
          <span className="text-slate-500 dark:text-slate-400">{t(status.labelKey)}</span>
          <span className="truncate text-slate-400 dark:text-slate-500">
            · {formatProviderModelCount(t, modelCount)}
          </span>
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
    </button>
  );
}, (prev, next) =>
  prev.provider.name === next.provider.name &&
  prev.provider.displayName === next.provider.displayName &&
  prev.provider.displayStatus === next.provider.displayStatus &&
  prev.provider.lastResult === next.provider.lastResult &&
  prev.provider.configStatus === next.provider.configStatus &&
  (prev.provider.models?.length ?? 0) === (next.provider.models?.length ?? 0) &&
  prev.inUse === next.inUse &&
  prev.onOpen === next.onOpen);

export function AiModelSettings({ startWithProviderPicker = false, compact = false }: {
  startWithProviderPicker?: boolean;
  compact?: boolean;
} = {}) {
  const t = useTranslation();
  const [providerPickerOpen, setProviderPickerOpen] = useState(startWithProviderPicker);
  // 使用自定义 Hook 获取状态和处理函数
  const {
    providers,
    isLoading,
    handleServiceUrlChange,
    handleProviderDefaultApiKeyChange,
    handleModelApiKeyChange,
    handleSingleProviderRefresh,
    handlePreferenceChange
  } = useProviderManagement();

  // 新增：失焦时保存/连接 API Key
  const handleDefaultApiKeyBlur = async (_providerName: string) => {
    // 这里可以根据需要添加保存/连接逻辑，或直接复用 handleProviderDefaultApiKeyChange
    // 由于 onBlur 时已调用 change，这里可用于额外的校验或提示
    // 可留空或补充日志
  };
  const handleModelApiKeyBlur = async (_modelName: string) => {
    // 这里可以根据需要添加保存/连接逻辑，或直接复用 handleModelApiKeyChange
    // 可留空或补充日志
  };

  // 添加 Provider 入口由对话框承载

  
  // Helper function to render the action buttons
  // 底部按钮已移除

  const searchParams = useSearchParams();
  const providerFromUrl = searchParams.get('provider');

  // 手机上进管理页先看列表：哪一家在用、哪一家连得上，一眼看见，而不是先选一个下拉。
  const conversationProviderName = useChatStore((state) => {
    const id = state.currentConversationId;
    const conv = id ? state.conversations.find((c: any) => c.id === id) : null;
    return conv?.model_provider ?? null;
  });
  const [lastUsedPair, setLastUsedPair] = useState<{ provider: string; modelId: string } | null>(null);
  useEffect(() => {
    if (!compact) return;
    let alive = true;
    void specializedStorage.models
      .getLastSelectedModelPair()
      .then((pair: any) => {
        if (alive && pair?.provider) setLastUsedPair(pair);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [compact]);
  const inUseProviderName = conversationProviderName ?? lastUsedPair?.provider ?? null;
  const [openProviderName, setOpenProviderName] = useState<string | null>(null);
  // 「日志导出」：手机不接 adb 时靠它把现场带走
  const [exportingLogs, setExportingLogs] = useState(false);
  const exportLogs = useCallback(async () => {
    setExportingLogs(true);
    try {
      const outcome = await exportAndroidLogs();
      switch (outcome.kind) {
        case 'shared':
          toast.success(t('androidLogs.shared'));
          break;
        case 'saved':
          toast.success(t('androidLogs.saved').replace('{0}', outcome.name));
          break;
        case 'clipboard':
          toast.success(t('androidLogs.copied'));
          break;
        case 'empty':
          toast.info(t('androidLogs.empty'));
          break;
        case 'cancelled':
          break;
        default:
          toast.error(t('androidLogs.failed'));
      }
    } catch (error) {
      console.error('[androidLogs] 导出失败', error);
      toast.error(t('androidLogs.failed'));
    } finally {
      setExportingLogs(false);
    }
  }, [t]);
  // 系统返回先收起服务详情、回到列表，而不是直接退出管理页。
  useEffect(() => {
    if (!compact || !openProviderName) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setOpenProviderName(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [compact, openProviderName]);

  // 搜索与过滤 state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<'all'|'recently_checked'|'needs_key'|'never_checked'>('all');
  // 如需更新 provider 配置请从 store 调用，当前未使用

  // 计算各状态的数量
  // 头部上下箭头切换，不再显示数量面板

  const filteredProviders = useMemo(() => {
    return providers.filter((p: ProviderWithStatus) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = (p.displayName || p.name).toLowerCase().includes(q) || p.name.toLowerCase().includes(q);
      const matchesStatus = (() => {
        switch (statusFilter) {
          case 'recently_checked':
            return p.lastCheckedAt && p.lastCheckedAt > Date.now() - 24 * 60 * 60 * 1000;
          case 'needs_key':
            return p.configStatus === 'NO_KEY';
          case 'never_checked':
            return !p.lastCheckedAt;
          case 'all':
          default:
            return true;
        }
      })();
      return matchesSearch && matchesStatus;
    });
  }, [providers, searchQuery, statusFilter]);

  const filteredNamesKey = useMemo(
    () => filteredProviders.map((p) => p.name).join('|'),
    [filteredProviders]
  );

  // 仅保存顺序；展示数据始终从 live providers 合并，避免状态刷新整表重建
  const [orderedNames, setOrderedNames] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const lastSyncRef = useRef<string>("");

  useEffect(() => {
    if (lastSyncRef.current === filteredNamesKey) return;
    lastSyncRef.current = filteredNamesKey;
    setOrderedNames((prev) => {
      const nextSet = new Set(filteredProviders.map((p) => p.name));
      const kept = prev.filter((name) => nextSet.has(name));
      const keptSet = new Set(kept);
      const appended = filteredProviders.map((p) => p.name).filter((name) => !keptSet.has(name));
      return [...kept, ...appended];
    });
  }, [filteredNamesKey, filteredProviders]);

  useEffect(() => {
    const names = new Set(filteredProviders.map((p) => p.name));
    if (providerFromUrl && names.has(providerFromUrl)) {
      setSelectedId(providerFromUrl);
      return;
    }
    setSelectedId((prev) => {
      if (prev && names.has(prev)) return prev;
      return filteredProviders[0]?.name ?? null;
    });
  }, [filteredNamesKey, providerFromUrl, filteredProviders]);

  const providersByName = useMemo(
    () => new Map(providers.map((p) => [p.name, p])),
    [providers]
  );

  const displayList = useMemo(
    () => orderedNames.map((name) => providersByName.get(name)).filter((p): p is ProviderWithStatus => !!p),
    [orderedNames, providersByName]
  );

  const handleSelectProvider = useCallback((name: string) => {
    setSelectedId(name);
  }, []);

  // 手机列表的顺序：使用中 > 已连接 > 需要密钥 > 无法连接 > 未检查（同档内保持用户排序）
  const mobileProviders = useMemo(
    () => sortProvidersForMobileList(displayList, inUseProviderName),
    [displayList, inUseProviderName],
  );

  const openProvider = useMemo(
    () =>
      openProviderName
        ? displayList.find((p) => p.name === openProviderName) ?? null
        : null,
    [displayList, openProviderName],
  );

  // 列表页得给出有得住的状态，不能整屏「未检查」：进来先按列表顺序跑一轮检查，
  // 「刷新状态」手动重跑。没密钥的跳过——再试一次答案也是同一个。
  const [statusSweep, setStatusSweep] = useState(0);
  const lastSweepRef = useRef(-1);
  const sweepTargetsRef = useRef<ProviderWithStatus[]>([]);
  sweepTargetsRef.current = mobileProviders;
  const hasProviders = mobileProviders.length > 0;
  useEffect(() => {
    if (!compact || !hasProviders) return;
    if (lastSweepRef.current === statusSweep) return;
    lastSweepRef.current = statusSweep;
    // 不能在这里取消：每检完一家列表就重新渲染，一取消就把下一家掐掉，而这一轮已经记账了。
    void (async () => {
      for (const target of sweepTargetsRef.current) {
        if (target.configStatus) continue;
        const fresh = sweepTargetsRef.current.find((p) => p.name === target.name) ?? target;
        await Promise.resolve(handleSingleProviderRefresh(fresh, false)).catch(() => {});
      }
    })();
  }, [compact, hasProviders, statusSweep, handleSingleProviderRefresh]);

  // dnd-kit 传感器
  // 调高触发距离，减少误触；限定触发元素为拖拽把手
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handleDragStart = (_event: DragStartEvent) => {
    // 仅用于激活拖拽感应，无需额外处理
  };
  const handleDragEnd = React.useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedNames.findIndex((name) => name === active.id);
    const newIndex = orderedNames.findIndex((name) => name === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(orderedNames, oldIndex, newIndex);
    setOrderedNames(next);
    try {
      const { providerRepository } = await import('@/lib/provider/ProviderRepository');
      await providerRepository.setUserOrder(next);
      toast.success(translate(useLocaleStore.getState().locale, 'provider.list.orderSaved'), {
        duration: 2000,
      });
    } catch (e) {
      console.error(e);
      toast.error(translate(useLocaleStore.getState().locale, 'provider.list.orderSaveFailed'), {
        duration: 2000,
      });
    }
  }, [orderedNames]);

  // 保持 DndContext 依赖长度稳定
  const handleDragMove = React.useCallback(() => {}, []);
  const handleDragOverEvt = React.useCallback(() => {}, []);
  const handleDragCancel = React.useCallback(() => {}, []);

  const selectedIdResolved = selectedId || displayList[0]?.name || null;
  const selectedProvider: ProviderWithStatus | null =
    (selectedIdResolved && providers.find((p) => p.name === selectedIdResolved)) ||
    (selectedIdResolved && displayList.find((p) => p.name === selectedIdResolved)) ||
    null;

  // 手机和桌面用同一份详情，只是放进去的位置不同。
  const renderProviderDetail = (provider: ProviderWithStatus | null) =>
    provider ? (
      <ProviderSettings
        key={provider.name}
        compact={compact}
        provider={provider}
        isConnecting={provider.displayStatus === 'CONNECTING'}
        isInitialChecking={isLoading}
        onUrlChange={handleServiceUrlChange}
        onDefaultApiKeyChange={handleProviderDefaultApiKeyChange}
        onDefaultApiKeyBlur={handleDefaultApiKeyBlur}
        onModelApiKeyChange={(modelName, apiKey) => handleModelApiKeyChange(provider.name, modelName, apiKey)}
        onModelApiKeyBlur={handleModelApiKeyBlur}
        onRefresh={handleSingleProviderRefresh}
        onPreferenceChange={handlePreferenceChange}
        open
      />
    ) : (
      <div className="h-full flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
        {compact ? t('chatStarter.noProvider') : t('provider.list.selectProvider')}
      </div>
    );

  // --- 渲染逻辑 ---
  return (
    <div className={cn("h-full min-h-0 flex overflow-hidden", compact && "flex-col")}>
      {compact ? (
        openProvider ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-1 border-b border-border px-1 py-1">
              <button
                type="button"
                onClick={() => setOpenProviderName(null)}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-slate-600 active:bg-muted dark:text-slate-300"
              >
                <ChevronLeft className="size-4 shrink-0" aria-hidden="true" />
                {t('androidChat.backToProviders')}
              </button>
            </div>
            <div className="min-h-0 flex-1">{renderProviderDetail(openProvider)}</div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-xs text-slate-500 dark:text-slate-400">{t('androidChat.providers')}</h2>
              <button
                type="button"
                onClick={() => setStatusSweep((n) => n + 1)}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs text-slate-500 active:bg-muted dark:text-slate-400"
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                {t('provider.list.refresh')}
              </button>
            </div>
            <ul className="space-y-2">
              {mobileProviders.map((provider) => (
                <li key={provider.name}>
                  <MobileProviderRow
                    provider={provider}
                    inUse={provider.name === inUseProviderName}
                    onOpen={() => setOpenProviderName(provider.name)}
                  />
                </li>
              ))}
            </ul>
            {mobileProviders.length === 0 && !isLoading && (
              <div className="px-3 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                {t('chatStarter.noProvider')}
              </div>
            )}
            <AddProvidersDialog
              open={providerPickerOpen}
              onOpenChange={setProviderPickerOpen}
              compact
              trigger={
                <Button type="button" variant="outline" className="mt-3 h-12 w-full">
                  {t('chatStarter.addProvider')}
                </Button>
              }
            />
          </div>
        )
      ) : (
      <div className="provider-rail w-52 shrink-0 flex flex-col min-h-0 border-r border-slate-200/50 dark:border-slate-700/40">
        <div className="flex-shrink-0 px-2 pt-2.5 pb-2 flex items-center gap-0.5">
          <SearchInput
            value={searchQuery}
            onChange={(e)=>setSearchQuery(e.target.value)}
            placeholder={t('provider.list.search')}
            variant="withIcon"
            allowClear
            className="flex-1 min-w-0"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex items-center gap-0.5 h-7 px-1.5 rounded-md text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-500/[0.08] dark:hover:bg-white/[0.06] focus:outline-none transition-colors whitespace-nowrap"
                title={t('provider.list.filter')}
              >
                {statusFilter === 'all' && t('provider.list.all')}
                {statusFilter === 'recently_checked' && t('provider.list.checked')}
                {statusFilter === 'needs_key' && t('provider.list.needsKey')}
                {statusFilter === 'never_checked' && t('provider.list.unchecked')}
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-24 p-1">
              <DropdownMenuItem onClick={() => setStatusFilter('all')} className="text-[11px] py-1.5">{t('provider.list.all')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter('recently_checked')} className="text-[11px] py-1.5">{t('provider.list.recentlyChecked')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter('needs_key')} className="text-[11px] py-1.5">{t('provider.connection.noKey')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter('never_checked')} className="text-[11px] py-1.5">{t('provider.list.neverChecked')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <AddProvidersDialog
            open={providerPickerOpen}
            onOpenChange={setProviderPickerOpen}
            trigger={
              <button
                className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-500/[0.08] dark:hover:bg-white/[0.06] focus:outline-none transition-colors"
                title={t('provider.chooser.title')}
              >
                <ServerCog className="w-3.5 h-3.5" />
              </button>
            }
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragOver={handleDragOverEvt}
            onDragCancel={handleDragCancel}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={orderedNames} strategy={verticalListSortingStrategy}>
              <div className="space-y-0.5">
                {displayList.map((provider) => (
                  <SortableProviderRow
                    key={provider.name}
                    provider={provider}
                    isSelected={provider.name === selectedId}
                    onSelect={handleSelectProvider}
                    onRefresh={handleSingleProviderRefresh}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {displayList.length === 0 && !isLoading && (
            <div className="px-3 py-12 text-center text-xs text-slate-500 dark:text-slate-400">
              <ServerCog className="w-7 h-7 mx-auto mb-2 opacity-35" />
              <p>{t('provider.list.noMatches')}</p>
            </div>
          )}
        </div>
      </div>

      )}

      {!compact && (
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
          {renderProviderDetail(selectedProvider)}
        </div>
      )}

      {compact && (
        // 临时调试用：手机不接 adb 时，这是把日志带出手机的唯一入口。
        <button
          type="button"
          onClick={() => void exportLogs()}
          disabled={exportingLogs}
          className="fixed bottom-24 right-4 z-50 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-background/95 px-4 text-sm text-foreground shadow-lg backdrop-blur active:scale-[0.98] disabled:opacity-60"
        >
          <FileDown className="size-4 shrink-0" aria-hidden="true" />
          {exportingLogs ? t('androidLogs.exporting') : t('androidLogs.export')}
        </button>
      )}
    </div>
  );
} 