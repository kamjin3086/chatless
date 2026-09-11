"use client";

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Select, SelectTrigger } from "@/components/ui/select";
import type { ProviderMetadata, ModelMetadata } from '@/lib/metadata/types';
import { metadataService } from '@/lib/metadata/MetadataService';
import { specializedStorage } from '@/lib/storage';
import Image from "next/image";
import { ModelBrandLogo } from './ModelBrandLogo';
// import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";
import { ModelSelectContent } from './ModelSelectContent';
import { ModelParametersDialog } from './ModelParametersDialog';
import { PROVIDER_ICON_EXTS, getResolvedUrlForBase, isUrlKnownMissing, getModelBrandLogoSrc, prewarmModelBrandLogos } from '@/lib/utils/logoService';
import { generateAvatarDataUrl } from '@/lib/avatar';
import { isOrcaRouterProvider } from '@/lib/orcarouter/adapters';
import { textCatalogKey, useOrcaCatalogStore } from '@/lib/orcarouter/catalogStore';
import type { OrcaModality } from '@/lib/orcarouter/catalog';

interface ModelSelectorProps {
  currentModelId: string | null;
  allMetadata: ProviderMetadata[];
  onModelChange: (newModelId: string) => void;
  disabled?: boolean;
  currentProviderName?: string;
  /** 当前输入区是否已附加图片：收窄到明确声明 image 输入的聊天模型。 */
  hasImageAttachment?: boolean;
  /** 当前输入区是否已附加文档：收窄到明确声明 file 输入的聊天模型。 */
  hasDocumentAttachment?: boolean;
}

export function ModelSelector({
  currentModelId,
  allMetadata,
  onModelChange,
  disabled = false,
  currentProviderName,
  hasImageAttachment = false,
  hasDocumentAttachment = false,
}: ModelSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [recentModels, setRecentModels] = useState<Array<{provider: string; modelId: string}>>([]);
  const [globalDefaultModel, setGlobalDefaultModel] = useState<string | null>(null);
  // const searchInputRef = useRef<HTMLInputElement>(null);
  // 读取并应用用户在设置中保存的 Provider 排序
  const [userOrder, setUserOrder] = useState<string[]>([]);
  
  // 模型参数设置弹窗状态
  const [parametersDialogOpen, setParametersDialogOpen] = useState(false);
  const [selectedModelForParams, setSelectedModelForParams] = useState<{
    providerName: string;
    modelId: string;
    modelLabel?: string;
  } | null>(null);

  useEffect(() => {
    (async () => {
      const pair = await specializedStorage.models.getLastSelectedModelPair();
      setGlobalDefaultModel(pair ? `${pair.provider}/${pair.modelId}` : null);
    })();
  }, []);

  // 每当元数据变化时，读取一次用户排序，确保聊天界面的下拉与设置页一致
  useEffect(() => {
    (async () => {
      try {
        const { providerRepository } = await import('@/lib/provider/ProviderRepository');
        const order = await providerRepository.getUserOrder();
        setUserOrder(order || []);
      } catch {
        setUserOrder([]);
      }
    })();
  }, [allMetadata]);

  useEffect(() => {
    const loadRecentModels = async () => {
      try {
        const { specializedStorage } = await import('@/lib/storage');
        const recent = await specializedStorage.models.getRecentModels();
        setRecentModels(recent || []);
      } catch (error) {
        console.error('加载最近使用模型失败:', error);
        setRecentModels([]);
      }
    };
    
    loadRecentModels();
  }, []);

  const updateRecentModels = async (providerName: string, modelId: string) => {
    try {
      const newPair = { provider: providerName, modelId };
      const newRecent = [newPair, ...recentModels.filter(p => !(p.provider === providerName && p.modelId === modelId))].slice(0, 3);
      setRecentModels(newRecent);
      
      const { specializedStorage } = await import('@/lib/storage');
      await specializedStorage.models.setRecentModels(newRecent);
    } catch (error) {
      console.error('更新最近使用模型失败:', error);
    }
  };

  const handleInternalModelChange = (value: string) => {
    let providerName: string | undefined;
    let modelId: string = value;
    if (value.includes('::')) {
      const parts = value.split('::');
      if (parts.length === 2) {
        providerName = parts[0];
        modelId = parts[1];
      }
    }

    // 更新最近使用列表（记录 provider+model）
    if (providerName) updateRecentModels(providerName, modelId);

    if (providerName) {
      (async () => {
        try {
          const { specializedStorage } = await import('@/lib/storage');
          await specializedStorage.models.setLastSelectedModelPair(providerName, modelId);
        } catch {
          // ignore
        }
      })();
      onModelChange(`${providerName}::${modelId}`);
    } else {
      onModelChange(modelId);
    }
  };

  const isImgSrc = (icon?: string): icon is string => {
    return Boolean(icon && typeof icon === 'string' && (icon.startsWith('/') || icon.startsWith('data:image')));
  };

  // 根据用户排序对元数据做稳定排序（不改变原数组引用）
  const sortedMetadata = useMemo(() => {
    const base = (allMetadata || []).slice();
    if (!userOrder || userOrder.length === 0) return base;
    return base.sort((a, b) => {
      const ua = userOrder.indexOf(a.name);
      const ub = userOrder.indexOf(b.name);
      if (ua === -1 && ub === -1) return 0;
      if (ua === -1) return 1;
      if (ub === -1) return -1;
      return ua - ub;
    });
  }, [allMetadata, userOrder]);

  const currentProvider = useMemo(() => {
    if (!sortedMetadata || sortedMetadata.length === 0 || !currentModelId) return null;
    // 优先：使用外部传入的 providerName 进行精确匹配
    if (currentProviderName) {
      const byName = sortedMetadata.find(p => p.name === currentProviderName);
      if (byName && byName.models.some(m => m.name === currentModelId)) return byName;
    }
    // 兜底：如果传入的 providerName 缺失或不匹配（例如应用重启后恢复阶段），
    // 则根据“最近选择的 pair”去定位，避免跨 provider 同名模型误配
    // 注意：此兜底只在渲染时做一次同步判断，不写入存储
    // no-op 占位，避免 tree-shaking 误删导入
    const byScan = sortedMetadata.find(p => p.models.some(m => m.name === currentModelId)) || null;
    return byScan;
  }, [sortedMetadata, currentModelId, currentProviderName]);

  // 统一的“当前会话需要哪些输入模态”：只有真正附加了图片/文件时才收窄候选模型。
  const requiredModalities = useMemo<OrcaModality[]>(() => {
    const mods: OrcaModality[] = [];
    if (hasImageAttachment) mods.push('image');
    if (hasDocumentAttachment) mods.push('file');
    return mods;
  }, [hasImageAttachment, hasDocumentAttachment]);

  // OrcaRouter 的模型目录按能力过滤：文本/多模态下拉都必须来自真实目录，绝不回退为自由输入。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { ProviderRegistry } = await import('@/lib/llm');
        const orca = ProviderRegistry.all().find((p) => isOrcaRouterProvider(p.name));
        if (!orca) return;
        const apiKey = await (orca as { readApiKey?: () => Promise<string | null> }).readApiKey?.();
        const catalog = await useOrcaCatalogStore.getState().load(
          textCatalogKey(requiredModalities),
          { apiBase: (orca as any).baseUrl, apiKey: apiKey || undefined },
        );
        if (cancelled) return;

        // 已选模型若不再兼容当前能力，必须清空并提示，不能静默保留错误值。
        if (currentModelId && isOrcaRouterProvider(currentProviderName || '') &&
            !catalog.models.some((m) => m.id === currentModelId)) {
          toast.warning('当前模型不支持所选附件类型，请重新选择');
          onModelChange('');
        }
      } catch (e) {
        console.warn('[ModelSelector] OrcaRouter 目录加载失败', e);
      }
    })();
    return () => { cancelled = true; };
  }, [requiredModalities, currentModelId, currentProviderName, onModelChange]);

  /** 用真实目录（已按当前能力过滤）替换 OrcaRouter provider 的 models 列表。 */
  const applyOrcaCatalog = useCallback((provider: ProviderMetadata): ProviderMetadata => {
    const catalog = useOrcaCatalogStore.getState().get(textCatalogKey(requiredModalities));
    if (!catalog) return provider;
    const allowed = new Set(catalog.models.map((m) => m.id));
    // options 绑定到当前能力过滤后的真实列表：不兼容的旧值不会出现在选项中。
    const models = provider.models
      .filter((m) => allowed.has(m.name))
      .map((m) => ({ ...m, label: catalog.models.find((c) => c.id === m.name)?.label || m.label }));
    return { ...provider, models };
  }, [requiredModalities]);

  // 统一：仅显示可见且“已配置密钥或无需密钥”的提供商，提升选择效率
  const visibleProviders = useMemo(() => {
    return sortedMetadata
      .filter((p: any) => {
        if (p?.isVisible === false) return false;
        // requiresApiKey=false → 一律显示（如本地 Ollama）
        if (p?.requiresApiKey === false) return true;
        // 需要密钥时：只显示已配置默认密钥或模型级密钥的
        const hasProviderKey = !!(p?.default_api_key && String(p.default_api_key).trim());
        if (hasProviderKey) return true;
        // 模型级密钥（任一模型有 api_key 即视为可用）
        const hasModelKey = Array.isArray(p?.models) && p.models.some((m: any) => !!(m?.api_key && String(m.api_key).trim()));
        return hasModelKey;
      })
      .map((p) => (isOrcaRouterProvider(p.name) ? applyOrcaCatalog(p) : p))
      // 目录已加载但过滤后为空时，不展示空的 OrcaRouter 分组
      .filter((p) => !isOrcaRouterProvider(p.name) || p.models.length > 0);
  }, [sortedMetadata, applyOrcaCatalog]);

  const filteredModels = useMemo(() => {
    const query = searchQuery.toLowerCase();
    if (!query) return visibleProviders;

    return visibleProviders.map(provider => ({
      ...provider,
      models: provider.models.filter(modelMeta =>
        modelMeta.name.toLowerCase().includes(query) ||
        provider.name.toLowerCase().includes(query)
      )
    })).filter(provider => provider.models.length > 0);
  }, [visibleProviders, searchQuery]);

  const recentModelDetails = useMemo(() => {
    const result: { provider: ProviderMetadata, model: ModelMetadata }[] = [];
    if (!visibleProviders) return result;
    recentModels.forEach(({ provider, modelId }) => {
      const p = visibleProviders.find(v => v.name === provider);
      const m = p?.models.find(mm => mm.name === modelId);
      if (p && m) result.push({ provider: p, model: m });
    });
    return result;
  }, [visibleProviders, recentModels]);

  // —— 选择器触发器上的图标显示（模型优先 → provider → 头像） ——
  const iconExts = PROVIDER_ICON_EXTS;
  // 仅用于触发图标预热等依赖；不直接使用变量避免未用告警
  useMemo(() => {
    if (!currentProvider || !currentModelId) return null;
    return currentProvider.models.find(m => m.name === currentModelId) || null;
  }, [currentProvider, currentModelId]);

  useMemo(() => {
    if (!currentProvider || !currentModelId) return '';
    const src = getModelBrandLogoSrc(currentModelId, currentProvider.name);
    if (!src) return '';
    const m = src.match(/^(.*)\.(svg|png|webp|jpeg|jpg)$/i);
    return m ? m[1] : src;
  }, [currentProvider, currentModelId]);
  // const [modelExtIdx] = useState(0);
  // const modelLogoSrc = modelLogoBase ? `${modelLogoBase}.${iconExts[Math.min(0, iconExts.length - 1)]}` : '';

  const providerIsCatalog = typeof currentProvider?.icon === 'string' && currentProvider.icon.startsWith('/llm-provider-icon/');
  const providerBase = providerIsCatalog ? (currentProvider?.icon as string).replace(/\.(svg|png|webp|jpeg|jpg)$/i, '') : (currentProvider?.icon || '');
  const [providerExtIdx, setProviderExtIdx] = useState(0);
  const providerCatalogSrc = providerIsCatalog ? (() => {
    const mapped = getResolvedUrlForBase(providerBase);
    if (mapped) return mapped;
    let idx = providerExtIdx;
    while (idx < iconExts.length && isUrlKnownMissing(`${providerBase}.${iconExts[idx]}`)) idx++;
    return `${providerBase}.${iconExts[Math.min(idx, iconExts.length - 1)]}`;
  })() : (currentProvider?.icon || '');
  const providerAvatarSrc = !providerIsCatalog && typeof currentProvider?.icon === 'string' && currentProvider.icon.startsWith('data:image')
    ? (currentProvider.icon)
    : generateAvatarDataUrl((currentProvider?.name || 'prov').toLowerCase(), currentProvider?.name || 'Provider', 20);
  const [useProviderIcon] = useState(false);

  const handleOpenChange = (open: boolean) => {
    if (open) {
      // 打开时由子组件内部聚焦输入框
      // 后台预热当前可见 provider 的品牌 logo（非阻塞）
      try {
        const modelsToWarm: Array<{ modelId: string; providerName?: string }> = [];
        filteredModels.forEach(p => p.models.forEach(m => modelsToWarm.push({ modelId: m.name, providerName: p.name })));
        // 仅预热前 50 个，避免大列表一次性预热过多
        prewarmModelBrandLogos(modelsToWarm, 8, { limit: 50 }).catch(()=>{});
      } catch (e) {
        // 忽略预热错误
        console.debug('logo prewarm skipped', e);
      }
    } else {
      // 关闭时清空搜索
      setSearchQuery('');
    }
  };

  const handleSetDefault = async (e: React.MouseEvent, providerName: string, modelName: string) => {
    e.stopPropagation();
    e.preventDefault();
    const newDefaultIdentifier = `${providerName}/${modelName}`;
    if (globalDefaultModel === newDefaultIdentifier) {
      await specializedStorage.models.removeLastSelectedModelPair?.();
      setGlobalDefaultModel(null);
      toast.info("默认模型已清除");
    } else {
      await specializedStorage.models.setLastSelectedModelPair(providerName, modelName);
      setGlobalDefaultModel(newDefaultIdentifier);
      toast.success(`${modelName} 已设为默认模型`);
    }
  };

  // 手动刷新模型列表
  const handleRefreshModels = async () => {
    try {
      const { useProviderMetaStore } = await import('@/store/providerMetaStore');
      const merged = metadataService.get();
      useProviderMetaStore.getState().setList(merged as any);
      toast.success('模型列表已刷新');
    } catch (e) {
      console.error('刷新模型列表失败', e);
      toast.error('刷新模型列表失败');
    }
  };

  // 处理打开模型参数设置弹窗
  const handleOpenParameters = (providerName: string, modelId: string, modelLabel?: string) => {
    setSelectedModelForParams({ providerName, modelId, modelLabel });
    setParametersDialogOpen(true);
  };

  // const getCurrentModelDisplayText = () => {
  //   if (!currentModelId || !currentProvider) return "选择模型";
  //   const model = currentProvider.models.find(m => m.name === currentModelId);
  //   const providerLabel = (currentProvider as any).displayName || currentProvider.name;
  //   const text = model?.label || currentModelId;
  //   const maxLength = 16;
  //   const modelText = text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
  //   return `${modelText} (${providerLabel})`;
  // };

  const SENTINEL_VALUE = '__none__';
  const pairSelection = useMemo(() => {
    if (currentProvider && currentModelId) return `${currentProvider.name}::${currentModelId}`;
    return null;
  }, [currentProvider, currentModelId]);

  const selectValue = searchQuery
    ? SENTINEL_VALUE
    : (pairSelection || currentModelId || '');

  return (
    <>
      <Select
        value={selectValue}
        onValueChange={handleInternalModelChange}
        disabled={disabled}
        onOpenChange={handleOpenChange}
      >
        <SelectTrigger className="h-7 px-1.5 bg-transparent border-0 rounded text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100/60 dark:hover:bg-gray-800/40 focus:ring-0">
          <span className="inline-flex items-center gap-1.5">
            {currentProvider && currentModelId ? (
              !useProviderIcon ? (
                <div className="w-4 h-4 bg-gray-100 dark:bg-gray-700 rounded-sm flex-shrink-0">
                <ModelBrandLogo
                  modelId={currentModelId}
                  providerName={currentProvider.name}
                  size={14}
                  fallbackSrc={providerCatalogSrc || providerAvatarSrc}
                  className="w-4 h-4 rounded-sm"
                />
                </div>
              ) : (
                isImgSrc(providerCatalogSrc) ? (
                  <div className="w-4 h-4 bg-gray-100 dark:bg-gray-700 rounded-sm flex-shrink-0">
                  <Image
                    src={providerCatalogSrc}
                    alt={currentProvider.name}
                    width={14}
                    height={14}
                    className="w-4 h-4 rounded-sm"
                    onError={() => {
                      if (providerIsCatalog && providerExtIdx < iconExts.length - 1) {
                        setProviderExtIdx(i => i + 1);
                      }
                    }}
                  />
                  </div>
                ) : (
                  <div className="w-4 h-4 bg-gray-100 dark:bg-gray-700 rounded-sm flex-shrink-0">
                  <Image
                    src={providerAvatarSrc}
                    alt={currentProvider.name}
                    width={14}
                    height={14}
                    className="w-4 h-4 rounded-sm"
                  />
                  </div>
                )
              )
            ) : null}
            <span className="truncate max-w-[200px]">
              {currentModelId
                ? currentProvider
                  ? `${(currentProvider.models.find(m=>m.name===currentModelId)?.label) || currentModelId} · ${((currentProvider as any).displayName || currentProvider.name)}`
                  : currentModelId
                : allMetadata.length === 0
                  ? '加载中...'
                  : '选择模型'}
            </span>
          </span>
        </SelectTrigger>
        
        <ModelSelectContent
          filteredModels={filteredModels}
          recentModelDetails={recentModelDetails}
          globalDefaultModel={globalDefaultModel}
          currentModelId={currentModelId}
          currentSelection={pairSelection}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onSetDefault={handleSetDefault}
          onRefresh={handleRefreshModels}
          onOpenChange={handleOpenChange}
          onOpenParameters={handleOpenParameters}
        />
      </Select>

      {/* 模型参数设置弹窗 */}
      <ModelParametersDialog
        open={parametersDialogOpen && !!selectedModelForParams}
        onOpenChange={setParametersDialogOpen}
        providerName={selectedModelForParams?.providerName || ''}
        modelId={selectedModelForParams?.modelId || ''}
        modelLabel={selectedModelForParams?.modelLabel}
      />
    </>
  );
} 