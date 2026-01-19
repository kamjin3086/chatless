"use client";

import React, { useState, useEffect, useRef } from 'react';
import Image from "next/image";
import { DndContext, PointerSensor, useSensor, useSensors, DragStartEvent, DragEndEvent, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
// import { SettingsSectionHeader } from "./SettingsSectionHeader";
// import { ModelCard } from "./ModelCard"; // 不再使用 ModelCard
import { ProviderSettings } from "./ProviderSettings";
import { ServerCog, RotateCcw, GripVertical } from "lucide-react";
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
// 头部过滤器已内化到表头，无需 Select 组件
// duplicate import removed

// 添加一个包含连接状态的 Provider 类型
// 导出接口，以便其他组件可以使用
// export interface ProviderWithStatus extends ProviderMetadata {
//   isConnected?: boolean; // 连接状态是可选的，初始可能未知
//   // 添加用于显示的状态和 tooltip
//   displayStatus?: 'CONNECTED' | 'CONNECTING' | 'NOT_CONNECTED' | 'NO_KEY' | 'UNKNOWN' | 'NO_FETCHER'; // <-- 添加 NO_FETCHER
//   statusTooltip?: string | null;
// }

export function AiModelSettings() {
  // 使用自定义 Hook 获取状态和处理函数
  const {
    providers,
    isLoading,
    isRefreshing,
    handleServiceUrlChange,
    handleProviderDefaultApiKeyChange,
    handleModelApiKeyChange,
    handleGlobalRefresh,
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

  // 搜索与过滤 state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<'all'|'recently_checked'|'needs_key'|'never_checked'>('all');
  // 如需更新 provider 配置请从 store 调用，当前未使用

  // 计算各状态的数量
  // 头部上下箭头切换，不再显示数量面板

  const filteredProviders = providers.filter((p: ProviderWithStatus) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = (p.displayName || p.name).toLowerCase().includes(q) || p.name.toLowerCase().includes(q);
    const matchesStatus = (() => {
      switch (statusFilter) {
        case 'recently_checked':
          // 最近检查：24小时内检查过
          return p.lastCheckedAt && p.lastCheckedAt > Date.now() - 24 * 60 * 60 * 1000;
        case 'needs_key':
          // 未配置密钥
          return p.configStatus === 'NO_KEY';
        case 'never_checked':
          // 未检查过：从未检查过
          return !p.lastCheckedAt;
        case 'all':
        default:
          return true;
      }
    })();
    return matchesSearch && matchesStatus;
  });

  // —— 左侧列表：拖拽排序 + 选中状态 ——
  const [localList, setLocalList] = useState<ProviderWithStatus[]>(filteredProviders);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 仅在筛选/源数据长度或集合变化时同步，避免每次 render 都触发 setState
  const lastSyncRef = useRef<string>("");
  useEffect(() => {
    // 更细的签名：当名称、默认密钥、URL、模型数量或显示状态变化时，同步到本地列表
    // 移除模型数量对父级列表同步的影响，避免新增模型时整个列表重建导致的折叠/滚动跳动
    const key = filteredProviders
      .map(p => `${p.name}:${p.displayName || ''}:${p.default_api_key ? '1' : '0'}:${p.api_base_url || ''}:${p.displayStatus || ''}`)
      .join('|');
    if (lastSyncRef.current !== key) {
      lastSyncRef.current = key;
      setLocalList(filteredProviders);
      // 若当前选中项不在新的列表中，则选中第一个可用 Provider
      if (!selectedId || !filteredProviders.some(p => p.name === selectedId)) {
        setSelectedId(filteredProviders[0]?.name ?? null);
      }
    }
  }, [filteredProviders, selectedId]);

  // dnd-kit 传感器
  // 调高触发距离，减少误触；限定触发元素为拖拽把手
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handleDragStart = (_event: DragStartEvent) => {
    // 仅用于激活拖拽感应，无需额外处理
  };
  const handleDragEnd = React.useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localList.findIndex((p: ProviderWithStatus) => p.name === active.id);
    const newIndex = localList.findIndex((p: ProviderWithStatus) => p.name === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(localList, oldIndex, newIndex);
    setLocalList(next);
    try {
      const { providerRepository } = await import('@/lib/provider/ProviderRepository');
      await providerRepository.setUserOrder(next.map((p: ProviderWithStatus)=>p.name));
      toast.success('已保存自定义排序',{
        duration: 2000,
      });
    } catch (e) {
      console.error(e);
      toast.error('保存排序失败',{
        duration: 2000,
      });
    }
  }, [localList]);

  // 保持 DndContext 依赖长度稳定
  const handleDragMove = React.useCallback(() => {}, []);
  const handleDragOverEvt = React.useCallback(() => {}, []);
  const handleDragCancel = React.useCallback(() => {}, []);

  // 左侧可拖拽 Provider 列表项
  function SortableProviderRow({ provider }: { provider: ProviderWithStatus }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: provider.name });
    const style: React.CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
      willChange: isDragging ? 'transform' : undefined,
    };

    const isSelected = provider.name === selectedId;
    const { iconSrc } = useStableProviderIcon(provider as any);
    
    // 简化状态显示：只在关键状态时显示小徽章
    const statusDot = provider.configStatus === 'NO_KEY' 
      ? { color: 'bg-amber-400 dark:bg-amber-500', tooltip: '未配置密钥' }
      : provider.displayStatus === 'NOT_CONNECTED'
      ? { color: 'bg-red-400 dark:bg-red-500', tooltip: '连接失败' }
      : null;

    // 格式化最后检查时间
    const formatLastChecked = (timestamp?: number) => {
      if (!timestamp) return '从未检查';
      const now = Date.now();
      const diff = now - timestamp;
      if (diff < 60000) return '刚刚检查';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
      return `${Math.floor(diff / 86400000)}天前`;
    };

    // 导入右键菜单组件和功能
    const { ContextMenu } = require('@/components/ui/context-menu');

    // 右键菜单项 - 常用功能在上，不常用功能用分隔线隔开
    const menuItems = React.useMemo(() => [
      {
        id: 'refresh',
        text: '刷新状态',
        action: () => {
          handleSingleProviderRefresh(provider);
        }
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
    ], [provider]);

    // 悬浮提示信息
    const tooltipContent = `${provider.displayName || provider.name}\n${formatLastChecked(provider.lastCheckedAt)}\n${provider.models?.length || 0} 个模型`;

    return (
      <ContextMenu menuItems={menuItems}>
        <div ref={setNodeRef} style={style} title={tooltipContent}>
          <button
            type="button"
            onClick={() => setSelectedId(provider.name)}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-2 text-left transition-colors relative group",
              isSelected
                ? "bg-blue-50/90 dark:bg-blue-900/25 text-blue-700 dark:text-blue-200 border-l-2 border-blue-500"
                : "hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-200 border-l-2 border-transparent"
            )}
          >
            {/* 拖拽手柄 */}
            <span
              className="flex-shrink-0 flex items-center justify-center w-4 h-4 text-slate-300 dark:text-slate-600 cursor-grab active:cursor-grabbing hover:text-slate-400 dark:hover:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="w-3 h-3" />
            </span>
            
            {/* 图标 */}
            <div className="flex-shrink-0 relative">
              <div className="w-7 h-7 rounded-md bg-slate-100/80 dark:bg-slate-800/80 flex items-center justify-center overflow-hidden">
                <Image
                  src={iconSrc}
                  alt={provider.displayName || provider.name}
                  className="w-5 h-5 object-contain"
                  draggable={false}
                  width={20}
                  height={20}
                />
              </div>
              {/* 状态点 */}
              {statusDot && (
                <span 
                  className={cn("absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-white dark:border-slate-900", statusDot.color)}
                  title={statusDot.tooltip}
                />
              )}
            </div>
            
            {/* 文本信息 */}
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate leading-tight text-xs">
                {provider.displayName || provider.name}
              </div>
            </div>
          </button>
        </div>
      </ContextMenu>
    );
  }

  // 进度条功能已移除，可在此处实现统计逻辑

  // 选中 Provider 详情
  const selectedProvider: ProviderWithStatus | null =
    (selectedId && localList.find((p) => p.name === selectedId)) ||
    localList[0] ||
    null;

  // --- 渲染逻辑 ---
  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      {/* 顶部标题栏：紧凑设计 */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">管理提供商</h2>
        
        {/* 刷新按钮 */}
        <button
          aria-label="刷新"
          title="刷新所有提供商状态"
          onClick={handleGlobalRefresh}
          disabled={isRefreshing || isLoading}
          className={cn(
            "w-8 h-8 rounded-md border border-slate-200/70 dark:border-slate-700/70 flex items-center justify-center",
            "text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400",
            "hover:bg-slate-50 dark:hover:bg-slate-800/50 focus:outline-none transition-colors disabled:opacity-50"
          )}
        >
          <RotateCcw className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin")} />
        </button>
      </div>

      {/* 主体：左侧列表 + 右侧详情 */}
      <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-2 flex-1 min-h-0 overflow-hidden">
        {/* 左侧 Provider 列表 */}
        <div className="flex flex-col bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/80 rounded-lg overflow-hidden shadow-sm">
          {/* 搜索栏 */}
          <div className="flex-shrink-0 px-2 py-2 border-b border-slate-200/80 dark:border-slate-700/80 flex items-center gap-1.5 bg-slate-50/50 dark:bg-slate-800/30">
            <SearchInput
              value={searchQuery}
              onChange={(e)=>setSearchQuery(e.target.value)}
              placeholder="搜索"
              variant="withIcon"
              allowClear
              className="h-7 flex-1 text-xs"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="px-1.5 h-6 text-[10px] text-slate-600 dark:text-slate-400 rounded hover:bg-slate-100 dark:hover:bg-slate-700/50 focus:outline-none transition-colors whitespace-nowrap"
                  title="筛选状态"
                >
                  {statusFilter === 'all' && '全部'}
                  {statusFilter === 'recently_checked' && '已检查'}
                  {statusFilter === 'needs_key' && '无密钥'}
                  {statusFilter === 'never_checked' && '未检查'}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-24 p-1">
                <DropdownMenuItem onClick={() => setStatusFilter('all')} className="text-[11px] py-1.5">全部</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setStatusFilter('recently_checked')} className="text-[11px] py-1.5">最近检查</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setStatusFilter('needs_key')} className="text-[11px] py-1.5">未配置密钥</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setStatusFilter('never_checked')} className="text-[11px] py-1.5">未检查过</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            
            {/* 管理提供商按钮 */}
            <AddProvidersDialog
              trigger={
                <button
                  className={cn(
                    "w-7 h-7 rounded-md border border-slate-200/70 dark:border-slate-700/70 flex items-center justify-center",
                    "text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400",
                    "hover:bg-slate-50 dark:hover:bg-slate-800/50 focus:outline-none transition-colors"
                  )}
                  title="添加或管理提供商"
                >
                  <ServerCog className="w-3.5 h-3.5" />
                </button>
              }
            />
          </div>

          {/* 列表区域 - 添加固定滚动条，避免跳动 */}
          <div className="flex-1 overflow-y-scroll" style={{ scrollbarGutter: 'stable' }}>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragMove={handleDragMove}
              onDragOver={handleDragOverEvt}
              onDragCancel={handleDragCancel}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={localList.map((p: ProviderWithStatus) => p.name)} strategy={verticalListSortingStrategy}>
                <div>
                  {localList.map((provider) => (
                    <SortableProviderRow key={provider.name} provider={provider} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {localList.length === 0 && !isLoading && (
              <div className="px-3 py-12 text-center text-xs text-slate-500 dark:text-slate-400">
                <ServerCog className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="font-medium">暂无匹配的提供商</p>
              </div>
            )}
          </div>
        </div>

        {/* 右侧详情面板 - 添加固定滚动条 */}
        <div className="flex flex-col min-w-0 overflow-hidden">
          {selectedProvider ? (
            <div className="h-full overflow-y-scroll" style={{ scrollbarGutter: 'stable' }}>
              <ProviderSettings
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
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200/70 dark:border-slate-700/70 rounded-lg bg-slate-50/30 dark:bg-slate-900/20">
              请从左侧选择一个提供商
            </div>
          )}
        </div>
      </div>
    </div>
  );
} 