"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors, DragStartEvent, DragEndEvent, closestCenter, DragOverlay } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SettingsCard } from "./SettingsCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
// import { ModelCard } from "./ModelCard"; // 不再使用 ModelCard
import { InfoBanner } from "./InfoBanner";
import { InputField } from "./InputField"; // 导入 InputField
import { ProviderSettings } from "./ProviderSettings"; // 导入新组件（下一步创建）
import { Server, RefreshCcw, KeyRound, ServerCog, Loader2, RotateCcw } from "lucide-react";
import FoldingLoader from '@/components/ui/FoldingLoader';
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
import { toast } from "@/components/ui/sonner"; // <-- 导入封装的 toast
import { Input } from "@/components/ui/input";
// 不再需要直接导入 tauriFetch
// import { fetch as tauriFetch } from '@tauri-apps/plugin-http'; 
// import { useProviderStatusStore } from '@/store/providerStatusStore'; // <-- 已修改路径
// 导入新的 Hook 和类型
import { useProviderManagement, ProviderWithStatus } from '@/hooks/useProviderManagement';
import { useProviderStore } from '@/store/providerStore';
import { cn } from "@/lib/utils"; // Assuming cn is used somewhere or will be
import { AddProvidersDialog } from './AddProvidersDialog';
import { OpenAICompatibleProviders } from './OpenAICompatibleProviders';
import { OpenAICompatibleHint } from './OpenAICompatibleHint';
import { Button } from '@/components/ui/button';
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
    connectingProviderName,
    handleServiceUrlChange,
    handleProviderDefaultApiKeyChange,
    handleModelApiKeyChange,
    handleUrlBlur,
    handleGlobalRefresh,
    handleSingleProviderRefresh,
    handlePreferenceChange
  } = useProviderManagement();

  // OpenAI兼容提示的显示状态
  const [showOpenAIHint, setShowOpenAIHint] = React.useState(true);

  // 检查是否应该显示OpenAI兼容提示
  React.useEffect(() => {
    const checkShouldShowHint = async () => {
      try {
        // 检查用户是否已经关闭过提示
        const dismissed = localStorage.getItem('openai-compatible-hint-dismissed');
        if (dismissed) {
          setShowOpenAIHint(false);
          return;
        }

        // 检查是否已经有自定义的OpenAI兼容提供商
        const hasCustomOpenAIProviders = providers.some(p => 
          p.isUserAdded && 
          (p as any).strategy === 'openai-compatible'
        );
        
        if (hasCustomOpenAIProviders) {
          setShowOpenAIHint(false);
        }
      } catch (error) {
        console.warn('Failed to check OpenAI hint status:', error);
      }
    };

    checkShouldShowHint();
  }, [providers]);

  const handleDismissOpenAIHint = () => {
    setShowOpenAIHint(false);
    try {
      localStorage.setItem('openai-compatible-hint-dismissed', 'true');
    } catch (error) {
      console.warn('Failed to save hint dismissal:', error);
    }
  };

  // 新增：失焦时保存/连接 API Key
  const handleDefaultApiKeyBlur = async (providerName: string) => {
    // 这里可以根据需要添加保存/连接逻辑，或直接复用 handleProviderDefaultApiKeyChange
    // 由于 onBlur 时已调用 change，这里可用于额外的校验或提示
    // 可留空或补充日志
  };
  const handleModelApiKeyBlur = async (modelName: string) => {
    // 这里可以根据需要添加保存/连接逻辑，或直接复用 handleModelApiKeyChange
    // 可留空或补充日志
  };

  // 添加 Provider 入口由对话框承载

  // Helper function to render the loading state
  const renderLoadingState = () => (
    <div className="p-6 text-center flex flex-col items-center justify-center min-h-[220px]">
      <div className="mb-3">
        <FoldingLoader size={48} />
      </div>
      <p className="text-gray-600 dark:text-gray-400">正在加载 AI 提供商配置...</p>
    </div>
  );

  // Helper function to render the empty state
  const renderEmptyState = () => (
    <p className="text-center text-gray-500 dark:text-gray-400 py-4">未找到任何 AI 提供商配置。</p>
  );
  
  // Helper function to render the action buttons
  // 底部按钮已移除

  // 搜索与过滤 state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<'all'|'connected'|'disconnected'>('all');
  const [showSearchInput, setShowSearchInput] = useState(false);
  const updateConfig = useProviderStore(s=>s.updateConfig);
  const updateModelKey = useProviderStore(s=>s.updateModelKey);

  const filteredProviders = providers.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" ||
      (statusFilter === "connected" && p.displayStatus === "CONNECTED") ||
      (statusFilter === "disconnected" && p.displayStatus !== "CONNECTED");
    return matchesSearch && matchesStatus;
  });

  // —— 拖拽排序：保存用户顺序 ——
  const [localList, setLocalList] = useState(filteredProviders);
  const [activeId, setActiveId] = useState<string | null>(null);
  // 由父级维护每个 provider 的展开状态，避免因列表刷新而丢失
  const [providerOpenMap, setProviderOpenMap] = useState<Record<string, boolean>>({});
  // 仅在筛选/源数据长度或集合变化时同步，避免每次 render 都触发 setState
  const lastSyncRef = useRef<string>("");
  useEffect(() => {
    // 更细的签名：当名称、默认密钥、URL、模型数量或显示状态变化时，同步到本地列表
    // 移除模型数量对父级列表同步的影响，避免新增模型时整个列表重建导致的折叠/滚动跳动
    const key = filteredProviders
      .map(p => `${p.name}:${p.default_api_key ? '1' : '0'}:${p.api_base_url || ''}:${p.displayStatus || ''}`)
      .join('|');
    if (lastSyncRef.current !== key) {
      lastSyncRef.current = key;
      setLocalList(filteredProviders);
    }
  }, [filteredProviders]);

  // dnd-kit 传感器
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = React.useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localList.findIndex((p: ProviderWithStatus) => p.name === active.id);
    const newIndex = localList.findIndex((p: ProviderWithStatus) => p.name === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(localList, oldIndex, newIndex);
    setLocalList(next);
    setActiveId(null);
    try {
      const { providerRepository } = await import('@/lib/provider/ProviderRepository');
      await providerRepository.setUserOrder(next.map((p: ProviderWithStatus)=>p.name));
      toast.success('已保存自定义排序');
    } catch (e) {
      console.error(e);
      toast.error('保存排序失败');
    }
  }, [localList]);

  // 保持 DndContext 依赖长度稳定
  const handleDragMove = React.useCallback(() => {}, []);
  const handleDragOverEvt = React.useCallback(() => {}, []);
  const handleDragCancel = React.useCallback(() => { setActiveId(null); }, []);

  // Sortable item with手柄
  function SortableProviderItem({ provider, children }: { provider: ProviderWithStatus; children: React.ReactNode }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: provider.name });
    const style: React.CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.6 : 1,
    };
    // 由顶层 openMap 控制展开态，默认折叠
    return (
      <div ref={setNodeRef} style={style} className={"group transition-shadow duration-200 "+(isDragging?"shadow-lg ring-1 ring-blue-300/60 rounded-lg scale-[0.998]":"") }>
        <div className="relative">
          {/* 竖向吸附把手：折叠时显示，展开后隐藏 */}
          {!providerOpenMap[provider.name] && (
            <button
              aria-label="拖拽排序"
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-2 cursor-grab active:cursor-grabbing text-gray-400/80 hover:text-gray-600 dark:text-gray-400/90 dark:hover:text-gray-200"
              {...attributes} {...listeners}
            >
              <svg viewBox="0 0 6 24" width="6" height="24" fill="currentColor" aria-hidden>
                <circle cx="3" cy="3" r="1"></circle>
                <circle cx="3" cy="9" r="1"></circle>
                <circle cx="3" cy="15" r="1"></circle>
                <circle cx="3" cy="21" r="1"></circle>
              </svg>
            </button>
          )}
          <div className="flex-1 pl-1">
            {React.cloneElement(children as any, {
              open: providerOpenMap[provider.name] ?? false,
              onOpenChange: (open: boolean) => setProviderOpenMap((m)=>({ ...m, [provider.name]: open }))
            })}
          </div>
        </div>
      </div>
    );
  }

  // 计算刷新进度
  const totalCount = providers.length;
  const checkedCount = providers.filter(p => p.displayStatus !== 'CONNECTING').length;

  // --- 渲染逻辑 ---
  return (
    <div className="space-y-6">
 {/* 页面标题 */}
 {/* <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-200 text-left">AI 模型配置</h1> */}


    <SettingsCard data-testid="settings-card-ai-model">
      <SettingsSectionHeader
        icon={ServerCog}
        title="管理提供商"
        iconBgColor="from-purple-500 to-indigo-500"
      />

      {/* OpenAI兼容服务提示 */}
      {showOpenAIHint && (
        <div className="mt-4">
          <OpenAICompatibleHint onDismiss={handleDismissOpenAIHint} />
        </div>
      )}

      {/* 提示栏 */}
      {/* <InfoBanner id="ai_provider_tip" message="配置不同 AI 提供商的服务地址和 API 密钥" type="info" className="mt-3" /> */}

      {/* 搜索 & 过滤 + 刷新按钮 */}
      <div className="flex items-center mt-4 gap-3 justify-between flex-wrap">
        <div className="flex gap-2 flex-wrap items-center">
          {(providers.length>6 || showSearchInput) && (
            showSearchInput ? (
              <Input
                autoFocus
                placeholder="搜索提供商..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onBlur={() => { if(searchQuery==="") setShowSearchInput(false); }}
                className="w-48 h-8 transition-all duration-200"
              />
            ) : (
              <button onClick={()=>setShowSearchInput(true)} className="p-2 text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-900/50 rounded-md transition-colors" title="搜索">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 103.5 3.5a7.5 7.5 0 0013.15 13.15z" /></svg>
              </button>
            )
          )}
          {/* 分段过滤按钮 */}
          <div className="inline-flex bg-gray-100 dark:bg-gray-700 rounded-md p-0.5">
            {([
              { id: 'all', label: '全部' },
              { id: 'connected', label: '已连接' },
              { id: 'disconnected', label: '未连接' },
            ] as const).map(seg => (
              <button
                key={seg.id}
                onClick={() => setStatusFilter(seg.id)}
                className={`px-3 h-7 text-xs rounded-md transition-colors ${statusFilter===seg.id ? 'bg-white dark:bg-gray-800 shadow text-gray-800 dark:text-gray-100' : 'text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'}`}
              >
                {seg.label}
              </button>
            ))}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleGlobalRefresh}
            disabled={isRefreshing || isLoading || connectingProviderName !== null}
            className="p-2 text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/50 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="刷新全部提供商状态"
          >
            <RotateCcw className={cn("w-4 h-4", isRefreshing && 'animate-spin')} />
          </button>
          
          {/* OpenAI兼容服务快速添加 */}
          <OpenAICompatibleProviders
            trigger={
              <Button variant="outline" size="sm">
                + OpenAI兼容
              </Button>
            }
            onProviderAdded={() => {
              // 刷新提供商列表
              setTimeout(() => {
                handleGlobalRefresh();
              }, 500);
            }}
          />
          
          <AddProvidersDialog
            trigger={
              <Button variant="secondary" size="sm">
                管理提供商
              </Button>
            }
          />
        </div>
      </div>

      {/* Provider 列表（支持拖拽排序） */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragMove={handleDragMove} onDragOver={handleDragOverEvt} onDragCancel={handleDragCancel} onDragEnd={handleDragEnd}>
        <SortableContext items={localList.map((p: ProviderWithStatus)=>p.name)} strategy={verticalListSortingStrategy}>
          <div className="space-y-4 mt-6">
            {localList.map((provider) => (
              <SortableProviderItem key={provider.name} provider={provider}>
                <ProviderSettings
                  provider={provider}
                  isConnecting={connectingProviderName === provider.name}
                  isInitialChecking={isLoading}
                  onUrlChange={(name, url) => handleServiceUrlChange(name, url)}
                  onUrlBlur={handleUrlBlur}
                  onDefaultApiKeyChange={(name, key) => handleProviderDefaultApiKeyChange(name, key)}
                  onDefaultApiKeyBlur={handleDefaultApiKeyBlur}
                  onModelApiKeyChange={(modelName, apiKey) => handleModelApiKeyChange(provider.name, modelName, apiKey)}
                  onModelApiKeyBlur={handleModelApiKeyBlur}
                  onRefresh={handleSingleProviderRefresh}
                  onPreferenceChange={handlePreferenceChange}
                />
              </SortableProviderItem>
            ))}
          </div>
        </SortableContext>
        {/* 拖拽中的跟随卡片（半透明、悬浮） */}
        <DragOverlay dropAnimation={{ duration: 150 }}>
          {activeId ? (
            <div className="opacity-70 scale-[0.98]">
              <ProviderSettings
                provider={localList.find(p=>p.name===activeId)!}
                isConnecting={false}
                isInitialChecking={false}
                onUrlChange={()=>{}}
                onUrlBlur={()=>{}}
                onDefaultApiKeyChange={()=>{}}
                onDefaultApiKeyBlur={()=>{}}
                onModelApiKeyChange={()=>{}}
                onModelApiKeyBlur={()=>{}}
                onRefresh={()=>{}}
              />
            </div>
          ) : null}
        </DragOverlay>
        
        {/* 初始检查提示 */}
        {/* {connectingProviderName && (
            <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                正在连接 {connectingProviderName}...
            </div>
        )} */}

        {/* 空状态提示 */}
        {providers.length === 0 && !isLoading && !connectingProviderName && (
            renderEmptyState()
        )}
      </DndContext>

      

    </SettingsCard>
    </div>
  );
} 