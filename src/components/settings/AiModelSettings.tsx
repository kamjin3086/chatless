"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Image from "next/image";
import { DndContext, PointerSensor, useSensor, useSensors, DragStartEvent, DragEndEvent, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
// import { SettingsSectionHeader } from "./SettingsSectionHeader";
// import { ModelCard } from "./ModelCard"; // 不再使用 ModelCard
import { ProviderSettings } from "./ProviderSettings";
import { ServerCog, GripVertical, ChevronDown } from "lucide-react";
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
import { useStableProviderIcon } from "./useStableProviderIcon";
import { useSearchParams } from "next/navigation";
import { ContextMenu } from "@/components/ui/context-menu";
// 头部过滤器已内化到表头，无需 Select 组件
// duplicate import removed

function formatLastChecked(timestamp?: number) {
  if (!timestamp) return '从未检查';
  const diff = Date.now() - timestamp;
  if (diff < 60000) return '刚刚检查';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${Math.floor(diff / 86400000)}天前`;
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
      text: '刷新状态',
      action: () => { onRefresh(provider); }
    },
    {
      id: 'copy-url',
      text: '复制服务地址',
      action: () => {
        const url = (provider as any).url || (provider as any).api_base_url || '';
        navigator.clipboard.writeText(url);
        toast.success('已复制服务地址', { duration: 2000 });
      }
    },
    {
      id: 'separator-1',
      text: '',
      separator: true
    },
    {
      id: 'toggle-visibility',
      text: provider.isVisible ? '隐藏提供商' : '显示提供商',
      action: async () => {
        try {
          const { providerRepository } = await import('@/lib/provider/ProviderRepository');
          await providerRepository.setVisibility(provider.name, !provider.isVisible);
          toast.success(provider.isVisible ? '已隐藏提供商' : '已显示提供商', { duration: 2000 });
        } catch (error) {
          console.error('切换可见性失败:', error);
          toast.error('操作失败');
        }
      }
    }
  ], [provider, onRefresh]);

  const tooltipContent = needsKey
    ? `${provider.displayName || provider.name}\n未配置密钥\n${formatLastChecked(provider.lastCheckedAt)}\n${provider.models?.length || 0} 个模型`
    : `${provider.displayName || provider.name}\n${formatLastChecked(provider.lastCheckedAt)}\n${provider.models?.length || 0} 个模型`;

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

          <div className={cn("w-5 h-5 rounded-[5px] overflow-hidden flex-shrink-0", needsKey && !isSelected && "opacity-60")}>
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

export function AiModelSettings() {
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
      toast.success('已保存自定义排序',{
        duration: 2000,
      });
    } catch (e) {
      console.error(e);
      toast.error('保存排序失败',{
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

  // --- 渲染逻辑 ---
  return (
    <div className="h-full min-h-0 flex overflow-hidden">
      <div className="provider-rail w-52 shrink-0 flex flex-col min-h-0 border-r border-slate-200/50 dark:border-slate-700/40">
        <div className="flex-shrink-0 px-2 pt-2.5 pb-2 flex items-center gap-0.5">
          <SearchInput
            value={searchQuery}
            onChange={(e)=>setSearchQuery(e.target.value)}
            placeholder="搜索"
            variant="withIcon"
            allowClear
            className="flex-1 min-w-0"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex items-center gap-0.5 h-7 px-1.5 rounded-md text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-500/[0.08] dark:hover:bg-white/[0.06] focus:outline-none transition-colors whitespace-nowrap"
                title="筛选状态"
              >
                {statusFilter === 'all' && '全部'}
                {statusFilter === 'recently_checked' && '已检查'}
                {statusFilter === 'needs_key' && '无密钥'}
                {statusFilter === 'never_checked' && '未检查'}
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-24 p-1">
              <DropdownMenuItem onClick={() => setStatusFilter('all')} className="text-[11px] py-1.5">全部</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter('recently_checked')} className="text-[11px] py-1.5">最近检查</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter('needs_key')} className="text-[11px] py-1.5">未配置密钥</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter('never_checked')} className="text-[11px] py-1.5">未检查过</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <AddProvidersDialog
            trigger={
              <button
                className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-500/[0.08] dark:hover:bg-white/[0.06] focus:outline-none transition-colors"
                title="添加或管理提供商"
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
              <p>暂无匹配的提供商</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
        {selectedProvider ? (
          <ProviderSettings
            key={selectedProvider.name}
            provider={selectedProvider}
            isConnecting={selectedProvider.displayStatus === 'CONNECTING'}
            isInitialChecking={isLoading}
            onUrlChange={handleServiceUrlChange}
            onDefaultApiKeyChange={handleProviderDefaultApiKeyChange}
            onDefaultApiKeyBlur={handleDefaultApiKeyBlur}
            onModelApiKeyChange={(modelName, apiKey) => handleModelApiKeyChange(selectedProvider.name, modelName, apiKey)}
            onModelApiKeyBlur={handleModelApiKeyBlur}
            onRefresh={handleSingleProviderRefresh}
            onPreferenceChange={handlePreferenceChange}
            open
          />
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
            请从左侧选择一个提供商
          </div>
        )}
      </div>
    </div>
  );
} 