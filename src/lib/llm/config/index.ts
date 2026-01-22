/**
 * LLM 配置模块
 * 
 * 导出工具调用配置相关的类型和函数
 */

export {
  // 类型
  type ToolCallStrategy,
  type ToolCallCapability,
  type ProviderToolCallConfig,
  type ModelToolCallConfig,
  
  // 配置数据
  PROVIDER_CONFIGS,
  MODEL_CONFIGS,
  
  // 函数
  inferProviderId,
  getProviderConfig,
  getModelConfig,
  detectCapability,
  getAllProviderConfigs,
  getAllModelConfigs,
} from './tool-call-config';

