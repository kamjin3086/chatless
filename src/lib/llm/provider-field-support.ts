/**
 * Provider字段支持配置与适配器
 * 
 * 职责（今天真的被用到的那部分）：
 * 决定参数对话框里出现哪些控件，两个对话框读它。
 *
 * 它**不**决定请求里的字段名：发出去的字段名写在各 Provider 文件里，
 * `adaptFieldsForProvider` 在本文件之外没有任何调用者。把这张表当成请求的地图是一张
 * 错误的地图；把两份答案合并是 #142，别在这里再加第三份局部答案。
 */

/**
 * Provider字段支持定义
 */
export interface ProviderFieldSupport {
  // 基础参数
  temperature?: boolean;
  maxTokens?: boolean;
  topP?: boolean;
  topK?: boolean;
  minP?: boolean;
  frequencyPenalty?: boolean;
  presencePenalty?: boolean;
  stopSequences?: boolean;
  
  // 扩展参数
  thinking?: boolean;      // Ollama等支持thinking模式
  streaming?: boolean;     // 大多数支持流式响应
  format?: boolean;        // Ollama支持format参数
}

/**
 * Provider完整配置（支持+映射+转换）
 */
export interface ProviderConfig {
  /** 支持的字段 */
  support: ProviderFieldSupport;
  
  /** 字段名称映射：通用名 -> Provider特定名 */
  fieldMapping?: Record<string, string>;
  
  /** 特殊字段转换规则 */
  transformers?: Record<string, (value: any, allOpts: Record<string, any>) => any>;
}

/**
 * 各Provider的完整配置（支持字段 + 字段映射 + 转换规则）
 */
export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  // Ollama - 支持最全面，使用snake_case
  'ollama': {
    support: {
      temperature: true,
      maxTokens: true,
      topP: true,
      topK: true,
      minP: true,
      frequencyPenalty: true,
      presencePenalty: true,
      stopSequences: true,
      thinking: true,
      streaming: true,
      format: true,
    },
    fieldMapping: {
      'topP': 'top_p',
      'topK': 'top_k',
      'minP': 'min_p',
      'maxTokens': 'num_predict',
      'maxOutputTokens': 'num_predict',
      'frequencyPenalty': 'frequency_penalty',
      'presencePenalty': 'presence_penalty',
      'stop': 'stop',
    },
  },
  
  // OpenAI - 标准OpenAI API，使用snake_case
  'openai': {
    support: {
      temperature: true,
      maxTokens: true,
      topP: true,
      frequencyPenalty: true,
      presencePenalty: true,
      stopSequences: true,
      streaming: true,
    },
    fieldMapping: {
      'topP': 'top_p',
      'maxTokens': 'max_tokens',
      'maxOutputTokens': 'max_tokens',
      'frequencyPenalty': 'frequency_penalty',
      'presencePenalty': 'presence_penalty',
      'stop': 'stop',
    },
  },
  
  // Google AI - 使用generationConfig嵌套结构
  'google-ai': {
    support: {
      temperature: true,
      maxTokens: true,
      topP: true,
      topK: true,
      // Gemini 的 generationConfig 收 minP，Provider 本来也把它透传出去了；写在这里
      // 对话框才会给出这个控件，而不是把一个真实存在的选项藏掉。
      minP: true,
      stopSequences: true,
      streaming: true,
    },
    // Google AI的字段映射在转换器中处理（需要放入generationConfig）
    fieldMapping: {
      'maxTokens': 'maxOutputTokens',
      'maxOutputTokens': 'maxOutputTokens',
      'stop': 'stopSequences',
    },
  },
  
  // Anthropic - 使用snake_case
  'anthropic': {
    support: {
      temperature: true,
      maxTokens: true,
      topP: true,
      topK: true,
      stopSequences: true,
      streaming: true,
    },
    fieldMapping: {
      'topP': 'top_p',
      'topK': 'top_k',
      'maxTokens': 'max_tokens',
      'maxOutputTokens': 'max_tokens',
      'stop': 'stop_sequences',
    },
  },
  
  // DeepSeek - 类OpenAI，使用snake_case
  'deepseek': {
    support: {
      temperature: true,
      maxTokens: true,
      topP: true,
      frequencyPenalty: true,
      presencePenalty: true,
      stopSequences: true,
      streaming: true,
    },
    fieldMapping: {
      'topP': 'top_p',
      'maxTokens': 'max_tokens',
      'maxOutputTokens': 'max_tokens',
      'frequencyPenalty': 'frequency_penalty',
      'presencePenalty': 'presence_penalty',
      'stop': 'stop',
    },
  },
};

/**
 * 兼容性：保留旧的PROVIDER_FIELD_SUPPORT导出
 * @deprecated 使用 PROVIDER_CONFIGS 替代
 */
export const PROVIDER_FIELD_SUPPORT: Record<string, ProviderFieldSupport> = Object.fromEntries(
  Object.entries(PROVIDER_CONFIGS).map(([key, config]) => [key, config.support])
);

/**
 * 获取Provider完整配置
 */
export function getProviderConfig(providerName: string): ProviderConfig {
  // 界面上用的是给人看的标签（'Google AI'），表格的键用的是 API 自己的写法
  // （'google-ai'）。只 toLowerCase 永远对不上 Gemini 那一行，于是每次都落到
  // OpenAI 形状的兜底：Gemini 的对话框因此不给 topK 和 minP，而上面的表格明明说它支持。
  const normalizedName = providerName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  
  // 尝试精确匹配
  if (PROVIDER_CONFIGS[normalizedName]) {
    return PROVIDER_CONFIGS[normalizedName];
  }
  
  // 尝试模糊匹配
  for (const [key, config] of Object.entries(PROVIDER_CONFIGS)) {
    if (normalizedName.includes(key) || key.includes(normalizedName)) {
      return config;
    }
  }
  
  // 默认配置：支持基础字段，使用snake_case
  return {
    support: {
      temperature: true,
      maxTokens: true,
      topP: true,
      stopSequences: true,
      streaming: true,
    },
    fieldMapping: {
      'topP': 'top_p',
      'maxTokens': 'max_tokens',
      'maxOutputTokens': 'max_tokens',
      'stop': 'stop',
    },
  };
}

/**
 * 获取Provider支持的字段配置（兼容旧接口）
 * @deprecated 使用 getProviderConfig 替代
 */
export function getProviderFieldSupport(providerName: string): ProviderFieldSupport {
  return getProviderConfig(providerName).support;
}

/**
 * Provider字段适配器 - 核心适配函数
 * 
 * 功能：
 * 1. 过滤不支持的字段
 * 2. 映射字段名称（通用名 -> Provider特定名）
 * 3. 应用特殊转换规则
 * 
 * @param providerName Provider名称
 * @param options 通用选项对象
 * @returns 适配后的Provider特定选项对象
 */
export function adaptFieldsForProvider(
  providerName: string,
  options: Record<string, any>
): Record<string, any> {
  const config = getProviderConfig(providerName);
  const result: Record<string, any> = {};
  
  // 字段映射（通用字段名 -> 支持配置key）
  const supportKeyMapping: Record<string, keyof ProviderFieldSupport> = {
    'temperature': 'temperature',
    'maxTokens': 'maxTokens',
    'maxOutputTokens': 'maxTokens',
    'topP': 'topP',
    'topK': 'topK',
    'minP': 'minP',
    'frequencyPenalty': 'frequencyPenalty',
    'presencePenalty': 'presencePenalty',
    'stop': 'stopSequences',
    'stopSequences': 'stopSequences',
    'thinking': 'thinking',
    'streaming': 'streaming',
    'format': 'format',
  };
  
  // 遍历所有选项
  for (const [key, value] of Object.entries(options)) {
    // 跳过内部/扩展字段
    if (key === 'extensions' || key === 'mcpServers') {
      continue;
    }
    
    const supportKey = supportKeyMapping[key];
    
    // 检查是否支持
    if (supportKey && !config.support[supportKey]) {
      console.log(`[ProviderFieldAdapter] 过滤不支持的字段: ${key} (Provider: ${providerName})`);
      continue;
    }
    
    // 映射字段名
    const targetKey = config.fieldMapping?.[key] || key;
    
    // 应用转换器（如果有）
    let targetValue = value;
    const transformer = config.transformers?.[key];
    if (transformer) {
      try {
        targetValue = transformer(value, options);
      } catch (error) {
        console.warn(`[ProviderFieldAdapter] 字段转换失败: ${key}`, error);
        targetValue = value; // 降级使用原值
      }
    }
    
    result[targetKey] = targetValue;
  }
  
  return result;
}

/**
 * 过滤不支持的字段（简化版，不做字段映射）
 * @deprecated 使用 adaptFieldsForProvider 替代，获得完整的适配功能
 */
export function filterUnsupportedFields(
  providerName: string,
  options: Record<string, any>
): Record<string, any> {
  const support = getProviderFieldSupport(providerName);
  const filtered: Record<string, any> = {};
  
  // 字段映射（参数名 -> 支持配置key）
  const fieldMapping: Record<string, keyof ProviderFieldSupport> = {
    'temperature': 'temperature',
    'maxTokens': 'maxTokens',
    'topP': 'topP',
    'topK': 'topK',
    'minP': 'minP',
    'frequencyPenalty': 'frequencyPenalty',
    'presencePenalty': 'presencePenalty',
    'stop': 'stopSequences',
    'thinking': 'thinking',
    'streaming': 'streaming',
    'format': 'format',
  };
  
  // 遍历所有选项
  for (const [key, value] of Object.entries(options)) {
    const supportKey = fieldMapping[key];
    
    // 如果字段在映射中且不被支持，则跳过
    if (supportKey && !support[supportKey]) {
      console.log(`[ProviderFieldSupport] 过滤不支持的字段: ${key} (Provider: ${providerName})`);
      continue;
    }
    
    // 保留字段
    filtered[key] = value;
  }
  
  return filtered;
}

