"use client";

import { create } from "zustand";
import StorageUtil from "@/lib/storage";
import type { ToolCallStrategy, ToolCallCapability } from "@/lib/llm/config/tool-call-config";
import { detectCapability } from "@/lib/llm/config/tool-call-config";

// 存储键
const STORAGE_FILE = 'tool-call-preferences.json';
const GLOBAL_STRATEGY_KEY = 'toolcall_global_strategy';
const PROVIDER_OVERRIDES_KEY = 'toolcall_provider_overrides';
const MODEL_OVERRIDES_KEY = 'toolcall_model_overrides';
const SHOW_TOOL_CALLS_KEY = 'toolcall_show_raw';
const AUTO_APPROVE_KEY = 'toolcall_auto_approve';

/**
 * Provider 级别覆盖配置
 */
interface ProviderOverride {
  strategy: ToolCallStrategy;
  enabled: boolean; // 是否启用覆盖
}

/**
 * 模型级别覆盖配置
 */
interface ModelOverride {
  providerId: string;
  modelPattern: string;
  strategy: ToolCallStrategy;
  enabled: boolean;
}

/**
 * 工具调用偏好设置状态
 */
interface ToolCallPreferencesState {
  // 初始化状态
  initialized: boolean;
  
  // 全局策略
  globalStrategy: ToolCallStrategy;
  
  // Provider 级别覆盖
  providerOverrides: Record<string, ProviderOverride>;
  
  // 模型级别覆盖 (key: "providerId:modelPattern")
  modelOverrides: Record<string, ModelOverride>;
  
  // UI/调试选项
  showRawToolCalls: boolean; // 开发者模式：显示原始工具调用
  autoApproveToolCalls: boolean; // 自动批准所有工具调用
  
  // Setters
  setGlobalStrategy: (strategy: ToolCallStrategy) => void;
  setProviderOverride: (providerId: string, override: ProviderOverride) => void;
  removeProviderOverride: (providerId: string) => void;
  setModelOverride: (key: string, override: ModelOverride) => void;
  removeModelOverride: (key: string) => void;
  setShowRawToolCalls: (show: boolean) => void;
  setAutoApproveToolCalls: (auto: boolean) => void;
  
  // 便捷方法
  getEffectiveStrategy: (providerId: string, modelName?: string) => ToolCallStrategy;
  shouldUseNativeToolCalls: (providerId: string, modelName?: string) => boolean;
  getCapabilityWithOverride: (providerId: string, modelName?: string) => {
    capability: ToolCallCapability;
    strategy: ToolCallStrategy;
    isOverridden: boolean;
    source: 'user-model' | 'user-provider' | 'user-global' | 'config-model' | 'config-provider';
  };
}

/**
 * 工具调用偏好设置 Store
 */
export const useToolCallPreferences = create<ToolCallPreferencesState>((set, get) => ({
  initialized: false,
  
  globalStrategy: 'auto',
  providerOverrides: {},
  modelOverrides: {},
  showRawToolCalls: false,
  autoApproveToolCalls: false,
  
  setGlobalStrategy: (strategy) => {
    set({ globalStrategy: strategy });
    void StorageUtil.setItem<ToolCallStrategy>(GLOBAL_STRATEGY_KEY, strategy, STORAGE_FILE);
  },
  
  setProviderOverride: (providerId, override) => {
    set((state) => ({
      providerOverrides: {
        ...state.providerOverrides,
        [providerId]: override,
      },
    }));
    void StorageUtil.setItem(PROVIDER_OVERRIDES_KEY, get().providerOverrides, STORAGE_FILE);
  },
  
  removeProviderOverride: (providerId) => {
    set((state) => {
      const { [providerId]: _removed, ...rest } = state.providerOverrides;
      return { providerOverrides: rest };
    });
    void StorageUtil.setItem(PROVIDER_OVERRIDES_KEY, get().providerOverrides, STORAGE_FILE);
  },
  
  setModelOverride: (key, override) => {
    set((state) => ({
      modelOverrides: {
        ...state.modelOverrides,
        [key]: override,
      },
    }));
    void StorageUtil.setItem(MODEL_OVERRIDES_KEY, get().modelOverrides, STORAGE_FILE);
  },
  
  removeModelOverride: (key) => {
    set((state) => {
      const { [key]: _removed, ...rest } = state.modelOverrides;
      return { modelOverrides: rest };
    });
    void StorageUtil.setItem(MODEL_OVERRIDES_KEY, get().modelOverrides, STORAGE_FILE);
  },
  
  setShowRawToolCalls: (show) => {
    set({ showRawToolCalls: show });
    void StorageUtil.setItem<boolean>(SHOW_TOOL_CALLS_KEY, show, STORAGE_FILE);
  },
  
  setAutoApproveToolCalls: (auto) => {
    set({ autoApproveToolCalls: auto });
    void StorageUtil.setItem<boolean>(AUTO_APPROVE_KEY, auto, STORAGE_FILE);
  },
  
  getEffectiveStrategy: (providerId, modelName) => {
    const state = get();
    
    // 1. 检查模型级别覆盖
    if (modelName) {
      for (const [, override] of Object.entries(state.modelOverrides)) {
        if (!override.enabled) continue;
        if (override.providerId !== providerId) continue;
        
        const regex = new RegExp(override.modelPattern, 'i');
        if (regex.test(modelName)) {
          return override.strategy;
        }
      }
    }
    
    // 2. 检查 Provider 级别覆盖
    const providerOverride = state.providerOverrides[providerId];
    if (providerOverride?.enabled) {
      return providerOverride.strategy;
    }
    
    // 3. 检查全局策略
    if (state.globalStrategy !== 'auto') {
      return state.globalStrategy;
    }
    
    // 4. 返回 auto，由调用者根据配置决定
    return 'auto';
  },
  
  shouldUseNativeToolCalls: (providerId, modelName) => {
    const state = get();
    const effectiveStrategy = state.getEffectiveStrategy(providerId, modelName);
    
    if (effectiveStrategy === 'native') return true;
    if (effectiveStrategy === 'prompt') return false;
    if (effectiveStrategy === 'disabled') return false;
    
    // auto: 根据配置检测
    const { capability } = detectCapability(providerId, modelName);
    return capability === 'native';
  },
  
  getCapabilityWithOverride: (providerId, modelName) => {
    const state = get();
    
    // 检测配置级别的能力
    const detected = detectCapability(providerId, modelName);
    
    // 检查用户覆盖
    // 1. 模型级别覆盖
    if (modelName) {
      for (const [, override] of Object.entries(state.modelOverrides)) {
        if (!override.enabled) continue;
        if (override.providerId !== providerId) continue;
        
        const regex = new RegExp(override.modelPattern, 'i');
        if (regex.test(modelName)) {
          return {
            capability: strategyToCapability(override.strategy, detected.capability),
            strategy: override.strategy,
            isOverridden: true,
            source: 'user-model' as const,
          };
        }
      }
    }
    
    // 2. Provider 级别覆盖
    const providerOverride = state.providerOverrides[providerId];
    if (providerOverride?.enabled) {
      return {
        capability: strategyToCapability(providerOverride.strategy, detected.capability),
        strategy: providerOverride.strategy,
        isOverridden: true,
        source: 'user-provider' as const,
      };
    }
    
    // 3. 全局覆盖
    if (state.globalStrategy !== 'auto') {
      return {
        capability: strategyToCapability(state.globalStrategy, detected.capability),
        strategy: state.globalStrategy,
        isOverridden: true,
        source: 'user-global' as const,
      };
    }
    
    // 4. 使用配置
    const source = detected.source === 'model' ? 'config-model' : 'config-provider';
    return {
      capability: detected.capability,
      strategy: capabilityToStrategy(detected.capability),
      isOverridden: false,
      source: source as 'config-model' | 'config-provider',
    };
  },
}));

/**
 * 将策略转换为能力
 */
function strategyToCapability(
  strategy: ToolCallStrategy,
  fallback: ToolCallCapability
): ToolCallCapability {
  switch (strategy) {
    case 'native':
      return 'native';
    case 'prompt':
      return 'prompt';
    case 'disabled':
      return 'none';
    case 'auto':
    default:
      return fallback;
  }
}

/**
 * 将能力转换为策略
 */
function capabilityToStrategy(capability: ToolCallCapability): ToolCallStrategy {
  switch (capability) {
    case 'native':
      return 'native';
    case 'prompt':
      return 'prompt';
    case 'experimental':
      return 'native'; // 实验性默认尝试原生
    case 'none':
      return 'disabled';
  }
}

// 异步初始化
void (async () => {
  try {
    const [globalStrategy, providerOverrides, modelOverrides, showRaw, autoApprove] = await Promise.all([
      StorageUtil.getItem<ToolCallStrategy>(GLOBAL_STRATEGY_KEY, 'auto', STORAGE_FILE),
      StorageUtil.getItem<Record<string, ProviderOverride>>(PROVIDER_OVERRIDES_KEY, {}, STORAGE_FILE),
      StorageUtil.getItem<Record<string, ModelOverride>>(MODEL_OVERRIDES_KEY, {}, STORAGE_FILE),
      StorageUtil.getItem<boolean>(SHOW_TOOL_CALLS_KEY, false, STORAGE_FILE),
      StorageUtil.getItem<boolean>(AUTO_APPROVE_KEY, false, STORAGE_FILE),
    ]);
    
    useToolCallPreferences.setState({
      globalStrategy: globalStrategy ?? 'auto',
      providerOverrides: providerOverrides ?? {},
      modelOverrides: modelOverrides ?? {},
      showRawToolCalls: showRaw ?? false,
      autoApproveToolCalls: autoApprove ?? false,
      initialized: true,
    });
  } catch (error) {
    console.warn('[ToolCallPreferences] 初始化失败:', error);
    useToolCallPreferences.setState({ initialized: true });
  }
})();

