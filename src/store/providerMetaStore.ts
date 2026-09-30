/**
 * providerMetaStore
 * --------------------------------------------------
 * 「UI 元数据层」
 * • 仅保存供前端展示的轻量信息 (QuickProviderMeta)
 * • 永远由 useProviderManagement 调用 setList() 进行同步
 * • UI 组件可以自由读 list，但 **严禁**直接调用 setList
 *   需要写入时，请走 useProviderManagement / ProviderService
 * • list 使用 ReadonlyArray 提升类型安全，避免误改
 * --------------------------------------------------
 */

import { create } from 'zustand';
import { ProviderRegistry } from '@/lib/llm';
import { defaultCacheManager } from '@/lib/cache/CacheManager';
import { PROVIDER_ICON_BASE } from '@/lib/utils/logoService';
import { EVENTS } from '@/lib/provider/events/keys';

// 简化的 Provider 元数据，用于 UI 展示
export interface QuickProviderMeta {
  name: string;
  aliases: string[];
  icon?: string;
  api_base_url: string;
  requiresApiKey: boolean;
  models: any[];
  displayStatus?: 'CONNECTED' | 'CONNECTING' | 'NOT_CONNECTED' | 'NO_KEY' | 'UNKNOWN' | 'NO_FETCHER';
  statusTooltip?: string | null;
  isUserAdded?: boolean;
  isVisible?: boolean;
}

interface ProviderMetaState {
  list: QuickProviderMeta[];
  setList: (list: QuickProviderMeta[]) => void;
  connectingSet: Set<string>;
  setConnecting: (name: string, on: boolean) => void;
}

function buildQuickList(): QuickProviderMeta[] {
  // 直接从ProviderRegistry获取所有providers，按PROVIDER_ORDER排序
  const { PROVIDER_ORDER } = require('@/lib/llm');
  const providers = ProviderRegistry.allInOrder(PROVIDER_ORDER);
  console.log(`[providerMetaStore] 从ProviderRegistry获取到 ${providers.length} 个providers:`, providers.map(p => p.name));
  
  return providers.map((p) => {
    const slug = p.name.toLowerCase().replace(/\s+/g, '-');
    
    // 从catalog中获取正确的requiresKey值
    const { AVAILABLE_PROVIDERS_CATALOG } = require('@/lib/provider/catalog');
    const catalogDef = AVAILABLE_PROVIDERS_CATALOG.find((def: any) => def.name === p.name);
    const requiresKey = catalogDef ? catalogDef.requiresKey : p.name !== 'Ollama'; // 兜底逻辑
    
    // 统一从 png 起步，减少首个 404；后续由 UI 的门面根据命中/缺失映射自动切换
    const icon = `${PROVIDER_ICON_BASE(slug)}.png`;
    return {
      name: p.name,
      aliases: [p.name],
      icon,
      api_base_url: (p as any).baseUrl ?? '',
      requiresApiKey: requiresKey,
      models: [],
      // 初始状态使用 UNKNOWN，避免误导性的"检查中"常驻显示
      displayStatus: 'UNKNOWN',
      statusTooltip: '初始化中…',
    };
  });
}

export const useProviderMetaStore = create<ProviderMetaState>((set, get) => ({
  list: buildQuickList(),
  setList: (list: QuickProviderMeta[]) => {
    const connecting = get().connectingSet;
    // 将临时“连接中”态覆盖到 displayStatus
    const withOverlay: QuickProviderMeta[] = list.map((p) => (
      connecting.has(p.name)
        ? { ...p, displayStatus: 'CONNECTING', statusTooltip: '正在检查状态…' as const }
        : p
    ));
    set({ list: withOverlay });
  },
  connectingSet: new Set<string>(),
  setConnecting: (name, on) => {
    const connecting = new Set(get().connectingSet);
    if (on) connecting.add(name); else connecting.delete(name);
    const list = get().list.map((p) => {
      if (p.name !== name) return p;
      if (on) {
        return { ...p, displayStatus: 'CONNECTING' as const, statusTooltip: '正在检查状态…' as const };
      }
      return {
        ...p,
        displayStatus: p.displayStatus === 'CONNECTING' ? undefined : p.displayStatus,
        statusTooltip: p.statusTooltip === '正在检查状态…' ? null : p.statusTooltip,
      };
    });
    set({ connectingSet: connecting, list });
  },
})); 

// 注意：UI 同步由 providerStore 统一触发（init/repository/model 订阅处）。
// 这里不再重复订阅 PROVIDERS_LIST，避免在开发环境下出现 HMR 重复导入与卡顿。
