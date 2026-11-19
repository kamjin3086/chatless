/**
 * 工具调用能力检测
 * 
 * ## 设计目标
 * 
 * 检测模型/Provider 是否支持原生工具调用，
 * 以便在不支持时降级使用 System Prompt 注入 + 正则解析。
 * 
 * ## 配置层级（优先级从高到低）
 * 
 * 1. 用户偏好设置（toolCallPreferences store）
 * 2. 开发者配置（tool-call-config.ts）
 * 3. 系统默认值
 * 
 * ## 参考资料
 * 
 * - LM Studio Tools: https://lmstudio.ai/docs/developer/openai-compat/tools
 * - Ollama Tool Calling: https://docs.ollama.com/capabilities/tool-calling
 */

import {
  detectCapability as detectConfigCapability,
  getProviderConfig,
  inferProviderId,
  type ToolCallCapability as ConfigCapability,
  type ToolCallStrategy as ConfigStrategy,
} from '../config/tool-call-config';

// Re-export types for compatibility
export type ToolCallCapability = ConfigCapability;
export type ToolCallStrategy = ConfigStrategy;

/**
 * Provider 类型
 */
export type ProviderType = 
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'ollama'
  | 'azure'
  | 'openrouter'
  | 'orcarouter'
  | 'mixroute'
  | 'novita'
  | 'aihubmix'
  | 'together'
  | 'groq'
  | 'mistral'
  | 'deepseek'
  | 'lmstudio'
  | 'custom'
  | 'unknown';

/**
 * 能力检测结果
 */
export interface CapabilityResult {
  /** 能力等级 */
  capability: ToolCallCapability;
  /** 支持的最大工具数量（0 表示无限制） */
  maxTools?: number;
  /** 是否支持并行工具调用 */
  parallelToolCalls?: boolean;
  /** 是否支持流式工具调用返回 */
  streamingToolCalls?: boolean;
  /** 备注 */
  note?: string;
  /** 来源 */
  source?: 'user' | 'config' | 'default';
}

/**
 * 从 Provider 名称推断类型
 */
export function inferProviderType(providerName: string): ProviderType {
  const id = inferProviderId(providerName);
  return id as ProviderType;
}

/**
 * 检测模型的工具调用能力
 * 
 * @param providerName Provider 名称
 * @param modelName 模型名称
 * @returns 能力检测结果
 */
export function detectToolCallCapability(
  providerName: string,
  modelName?: string
): CapabilityResult {
  // 使用 tool-call-config 的检测逻辑
  const detected = detectConfigCapability(providerName, modelName);
  const providerConfig = getProviderConfig(providerName);
  
  return {
    capability: detected.capability,
    parallelToolCalls: providerConfig.parallelSupport,
    streamingToolCalls: providerConfig.streamingSupport,
    note: detected.note,
    source: detected.source === 'model' || detected.source === 'provider' ? 'config' : 'default',
  };
}

/**
 * 一次 run 走哪条工具通道。
 *
 * - `native`：请求里带 `tools`，调用从 API 的 `tool_calls` 回来；
 * - `prompt`：请求里不带工具，提示词注入一份文本协议，回流文本由解析器变成调用；
 * - `disabled`：用户把该 provider 的工具调用关了，什么都不跑、也不宣传。
 *
 * 存在的原因：此前只有 `useNativeTools: boolean`，于是“不是原生”同时被读成“没有工具”，
 * 自定义/聚合端点整条通道被关死（#160）。通道是三档，不是一个布尔。
 */
export type ToolTrack = 'native' | 'prompt' | 'disabled';

/** 用户在该 provider 上选的策略，或 `auto` 表示交给能力表。 */
export function trackFor(
  strategy: ToolCallStrategy | 'auto',
  capability: ToolCallCapability
): ToolTrack {
  if (strategy === 'native') return 'native';
  if (strategy === 'prompt') return 'prompt';
  if (strategy === 'disabled') return 'disabled';
  if (capability === 'none') return 'disabled';
  // `experimental` is a usable rung - "unverified", not "dead". The source the table reports
  // still says unverified, so the UI can keep its note.
  if (capability === 'native' || capability === 'experimental') return 'native';
  return 'prompt';
}

/** The track for this provider+model, honouring a user override when the store is ready. */
export function resolveToolTrack(providerName: string, modelName?: string): ToolTrack {
  const capability = detectToolCallCapability(providerName, modelName).capability;
  try {
    // 动态导入以避免循环依赖
    const { useToolCallPreferences } = require('@/store/toolCallPreferences');
    const state = useToolCallPreferences.getState();
    if (state.initialized) {
      return trackFor(
        state.getEffectiveStrategy(inferProviderId(providerName), modelName),
        capability
      );
    }
  } catch {
    // Store 尚未初始化，使用配置检测
  }
  return trackFor('auto', capability);
}

/**
 * 检查是否应该使用原生工具调用
 * 
 * 此函数会检查用户偏好设置，然后回退到配置检测
 * 
 * @param providerName Provider 名称
 * @param modelName 模型名称
 * @returns 是否应该使用原生工具调用
 */
export function shouldUseNativeToolCalls(
  providerName: string,
  modelName?: string
): boolean {
  // One answer, in one place: the track decides, and native is one of its three values.
  return resolveToolTrack(providerName, modelName) === 'native';
}

/**
 * 获取工具调用策略建议
 * 
 * @param providerName Provider 名称
 * @param modelName 模型名称
 * @returns 策略建议对象
 */
export function getToolCallStrategy(
  providerName: string,
  modelName?: string
): {
  useNative: boolean;
  usePromptInjection: boolean;
  maxTools: number;
  parallelToolCalls: boolean;
  streamingToolCalls: boolean;
  note?: string;
  source?: 'user' | 'config' | 'default';
} {
  const result = detectToolCallCapability(providerName, modelName);
  const useNative = shouldUseNativeToolCalls(providerName, modelName);
  
  return {
    useNative,
    usePromptInjection: !useNative,
    maxTools: result.maxTools ?? 0,
    parallelToolCalls: result.parallelToolCalls ?? false,
    streamingToolCalls: result.streamingToolCalls ?? false,
    note: result.note,
    source: result.source,
  };
}

/**
 * 获取完整的能力信息（包含用户覆盖状态）
 * 
 * @param providerName Provider 名称
 * @param modelName 模型名称
 * @returns 完整的能力信息
 */
export function getCapabilityInfo(
  providerName: string,
  modelName?: string
): {
  capability: ToolCallCapability;
  strategy: ToolCallStrategy;
  isUserOverride: boolean;
  source: 'user-model' | 'user-provider' | 'user-global' | 'config-model' | 'config-provider' | 'default';
  parallelToolCalls: boolean;
  streamingToolCalls: boolean;
  note?: string;
} {
  const providerId = inferProviderId(providerName);
  const providerConfig = getProviderConfig(providerName);
  
  try {
    // 尝试从用户偏好获取
    const { useToolCallPreferences } = require('@/store/toolCallPreferences');
    const state = useToolCallPreferences.getState();
    
    if (state.initialized) {
      const result = state.getCapabilityWithOverride(providerId, modelName);
      return {
        capability: result.capability,
        strategy: result.strategy,
        isUserOverride: result.isOverridden,
        source: result.source,
        parallelToolCalls: providerConfig.parallelSupport,
        streamingToolCalls: providerConfig.streamingSupport,
        note: providerConfig.note,
      };
    }
  } catch {
    // Store 尚未初始化
  }
  
  // 回退到配置检测
  const detected = detectConfigCapability(providerName, modelName);
  return {
    capability: detected.capability,
    strategy: capabilityToStrategy(detected.capability),
    isUserOverride: false,
    source: detected.source === 'model' ? 'config-model' : 'config-provider',
    parallelToolCalls: providerConfig.parallelSupport,
    streamingToolCalls: providerConfig.streamingSupport,
    note: detected.note,
  };
}

/**
 * 将能力等级转换为策略
 */
function capabilityToStrategy(capability: ToolCallCapability): ToolCallStrategy {
  switch (capability) {
    case 'native':
      return 'native';
    case 'prompt':
      return 'prompt';
    case 'experimental':
      return 'auto'; // 实验性由 auto 决定
    case 'none':
      return 'disabled';
    default:
      return 'auto';
  }
}
