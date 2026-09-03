/**
 * 工具调用策略配置
 * 
 * ## 设计目标
 * 
 * 1. **开发期间**：集中管理各 Provider/模型的工具调用能力，便于版本更新
 * 2. **运行时**：支持用户覆盖默认策略
 * 
 * ## 配置层级（优先级从高到低）
 * 
 * 1. 用户针对特定模型的设置
 * 2. 用户针对特定 Provider 的设置
 * 3. 用户全局设置
 * 4. 模型特定配置（MODEL_CONFIGS）
 * 5. Provider 默认配置（PROVIDER_CONFIGS）
 * 6. 系统默认值
 * 
 * ## 参考资料
 * 
 * - LM Studio Tools: https://lmstudio.ai/docs/developer/openai-compat/tools
 * - Ollama Tool Calling: https://docs.ollama.com/capabilities/tool-calling
 */

/**
 * 工具调用策略
 */
export type ToolCallStrategy = 
  | 'auto'        // 自动检测（根据配置决定）
  | 'native'      // 强制使用原生 API
  | 'prompt'      // 强制使用提示词注入
  | 'disabled';   // 禁用工具调用

/**
 * 工具调用能力等级
 */
export type ToolCallCapability = 
  | 'native'       // 原生支持（通过 API tools 参数）
  | 'prompt'       // 仅支持 Prompt 注入
  | 'experimental' // 实验性支持（可能不稳定）
  | 'none';        // 不支持

/**
 * Provider 工具调用配置
 */
export interface ProviderToolCallConfig {
  /** Provider 标识 */
  id: string;
  /** 显示名称 */
  displayName: string;
  /** 默认能力 */
  defaultCapability: ToolCallCapability;
  /** 是否支持流式工具调用 */
  streamingSupport: boolean;
  /** 是否支持并行工具调用 */
  parallelSupport: boolean;
  /** 需要的最低 API 版本（如果有） */
  minApiVersion?: string;
  /** 备注说明 */
  note?: string;
  /** 文档链接 */
  docsUrl?: string;
}

/**
 * 模型工具调用配置
 */
export interface ModelToolCallConfig {
  /** 模型名称模式（正则表达式字符串） */
  pattern: string;
  /** 能力等级 */
  capability: ToolCallCapability;
  /** 是否覆盖 Provider 默认配置 */
  overrideProvider: boolean;
  /** 备注 */
  note?: string;
}

/**
 * Provider 默认配置
 * 
 * 基于各 Provider 的官方文档和实际测试
 */
export const PROVIDER_CONFIGS: Record<string, ProviderToolCallConfig> = {
  // ========== 完全支持原生工具调用的 Provider ==========
  
  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    defaultCapability: 'native',
    streamingSupport: true,
    parallelSupport: true,
    note: '完整支持 Function Calling 和 Tools API',
    docsUrl: 'https://platform.openai.com/docs/guides/function-calling',
  },
  
  anthropic: {
    id: 'anthropic',
    displayName: 'Anthropic',
    defaultCapability: 'native',
    streamingSupport: true,
    parallelSupport: true,
    note: 'Claude 3+ 完整支持工具调用',
    docsUrl: 'https://docs.anthropic.com/en/docs/tool-use',
  },
  
  azure: {
    id: 'azure',
    displayName: 'Azure OpenAI',
    defaultCapability: 'native',
    streamingSupport: true,
    parallelSupport: true,
    note: '与 OpenAI 兼容的工具调用支持',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/function-calling',
  },
  
  google: {
    id: 'google',
    displayName: 'Google (Gemini)',
    defaultCapability: 'native',
    streamingSupport: false, // Gemini 流式工具调用支持有限
    parallelSupport: true,
    note: 'Gemini Pro/Ultra 支持 Function Calling',
    docsUrl: 'https://ai.google.dev/docs/function_calling',
  },
  
  groq: {
    id: 'groq',
    displayName: 'Groq',
    defaultCapability: 'native',
    streamingSupport: true,
    parallelSupport: true,
    note: '支持 OpenAI 兼容的工具调用',
    docsUrl: 'https://console.groq.com/docs/tool-use',
  },
  
  mistral: {
    id: 'mistral',
    displayName: 'Mistral AI',
    defaultCapability: 'native',
    streamingSupport: true,
    parallelSupport: true,
    note: 'Mistral Large/Medium 支持工具调用',
    docsUrl: 'https://docs.mistral.ai/capabilities/function_calling/',
  },
  
  deepseek: {
    id: 'deepseek',
    displayName: 'DeepSeek',
    defaultCapability: 'native',
    streamingSupport: true,
    parallelSupport: true,
    note: 'DeepSeek-V3/Coder 支持工具调用',
    docsUrl: 'https://api-docs.deepseek.com/guides/function_calling',
  },
  
  together: {
    id: 'together',
    displayName: 'Together AI',
    defaultCapability: 'native',
    streamingSupport: true,
    parallelSupport: false, // Together 不支持并行调用
    note: '支持部分模型的工具调用',
    docsUrl: 'https://docs.together.ai/docs/function-calling',
  },
  
  openrouter: {
    id: 'openrouter',
    displayName: 'OpenRouter',
    defaultCapability: 'native',
    streamingSupport: true,
    parallelSupport: true,
    note: '能力取决于底层模型，大多数支持',
    docsUrl: 'https://openrouter.ai/docs#tool-use',
  },

  orcarouter: {
    id: 'orcarouter',
    displayName: 'OrcaRouter',
    defaultCapability: 'native',
    streamingSupport: true,
    parallelSupport: true,
    note: '能力取决于底层模型，大多数支持',
    docsUrl: 'https://docs.orcarouter.ai/advanced/tool-calling',
  },

  mixroute: {
    id: 'mixroute',
    displayName: 'MixRoute',
    defaultCapability: 'native',
    streamingSupport: true,
    parallelSupport: true,
    note: '能力取决于底层模型，大多数支持',
    docsUrl: 'https://docs.mixroute.ai',
  },

  novita: {
    id: 'novita',
    displayName: 'Novita',
    defaultCapability: 'native',
    streamingSupport: true,
    parallelSupport: true,
    note: '能力取决于底层模型，大多数支持',
    docsUrl: 'https://novita.ai/docs',
  },

  aihubmix: {
    id: 'aihubmix',
    displayName: 'AIHubMix',
    defaultCapability: 'native',
    streamingSupport: true,
    parallelSupport: true,
    note: '能力取决于底层模型，大多数支持',
    docsUrl: 'https://docs.aihubmix.com',
  },
  
  // ========== OpenAI 兼容但需要特殊处理的 Provider ==========
  
  lemonade: {
    id: 'lemonade',
    displayName: 'Lemonade',
    defaultCapability: 'native',
    streamingSupport: true,
    parallelSupport: true,
    note: '工具调用能力取决于 Lemonade 加载的底层模型',
    docsUrl: 'https://lemonade-server.ai',
  },

  lmstudio: {
    id: 'lmstudio',
    displayName: 'LM Studio',
    defaultCapability: 'native',
    streamingSupport: true,
    parallelSupport: true,
    note: '支持 OpenAI 兼容的工具调用，需要加载支持工具的模型',
    docsUrl: 'https://lmstudio.ai/docs/developer/openai-compat/tools',
  },
  
  ollama: {
    id: 'ollama',
    displayName: 'Ollama',
    defaultCapability: 'native', // Ollama 0.4+ 支持原生工具调用
    streamingSupport: true,
    parallelSupport: false,
    minApiVersion: '0.4.0',
    note: '需要 Ollama 0.4+ 且使用支持工具的模型（如 Llama 3.1+, Mistral）',
    docsUrl: 'https://docs.ollama.com/capabilities/tool-calling',
  },
  
  // ========== 仅支持 Prompt 注入的 Provider ==========
  
  custom: {
    id: 'custom',
    displayName: '自定义端点',
    defaultCapability: 'prompt',
    streamingSupport: false,
    parallelSupport: false,
    note: '自定义端点默认使用提示词注入，可手动启用原生模式',
  },
  
  unknown: {
    id: 'unknown',
    displayName: '未知 Provider',
    defaultCapability: 'prompt',
    streamingSupport: false,
    parallelSupport: false,
    note: '未识别的 Provider 默认使用提示词注入',
  },
};

/**
 * 模型特定配置
 * 
 * 用于覆盖 Provider 默认配置
 * pattern 使用正则表达式匹配模型名称
 */
export const MODEL_CONFIGS: ModelToolCallConfig[] = [
  // ========== GPT-OSS / Harmony 格式模型 ==========
  // GPT-OSS 使用 OpenAI Harmony 格式，不支持原生 OpenAI 工具调用 API
  // 参考: https://github.com/openai/harmony
  {
    pattern: 'gpt-?oss',
    capability: 'prompt',
    overrideProvider: true,
    note: 'GPT-OSS 使用 Harmony 格式，需要通过提示词注入工具调用',
  },
  {
    pattern: 'harmony',
    capability: 'prompt',
    overrideProvider: true,
    note: 'Harmony 格式模型不支持原生工具调用 API',
  },
  
  // ========== 不支持工具调用的模型 ==========
  {
    pattern: '^gpt-3\\.5-turbo-instruct',
    capability: 'none',
    overrideProvider: true,
    note: 'Instruct 模型不支持工具调用',
  },
  {
    pattern: '^text-davinci',
    capability: 'none',
    overrideProvider: true,
    note: '旧版 completion 模型不支持工具调用',
  },
  {
    pattern: '^claude-instant-1',
    capability: 'prompt',
    overrideProvider: true,
    note: 'Claude Instant 1 不支持原生工具调用',
  },
  {
    pattern: '^claude-2(?:\\.0)?$',
    capability: 'prompt',
    overrideProvider: true,
    note: 'Claude 2.0 不支持原生工具调用',
  },
  
  // ========== Ollama 模型特定配置 ==========
  // 基于 https://docs.ollama.com/capabilities/tool-calling
  {
    pattern: '^llama3\\.1',
    capability: 'native',
    overrideProvider: false,
    note: 'Llama 3.1 原生支持工具调用',
  },
  {
    pattern: '^llama3\\.2',
    capability: 'native',
    overrideProvider: false,
    note: 'Llama 3.2 原生支持工具调用',
  },
  {
    pattern: '^llama3\\.3',
    capability: 'native',
    overrideProvider: false,
    note: 'Llama 3.3 原生支持工具调用',
  },
  {
    pattern: '^mistral(?:-nemo)?',
    capability: 'native',
    overrideProvider: false,
    note: 'Mistral 系列支持工具调用',
  },
  {
    pattern: '^qwen2\\.5',
    capability: 'native',
    overrideProvider: false,
    note: 'Qwen 2.5 支持工具调用',
  },
  {
    pattern: '^qwq',
    capability: 'native',
    overrideProvider: false,
    note: 'QwQ 支持工具调用',
  },
  {
    pattern: '^command-r',
    capability: 'native',
    overrideProvider: false,
    note: 'Command R 系列支持工具调用',
  },
  {
    pattern: '^hermes3',
    capability: 'native',
    overrideProvider: false,
    note: 'Hermes 3 支持工具调用',
  },
  {
    pattern: '^athene-v2',
    capability: 'native',
    overrideProvider: false,
    note: 'Athene v2 支持工具调用',
  },
  {
    pattern: '^nemotron',
    capability: 'native',
    overrideProvider: false,
    note: 'Nemotron 支持工具调用',
  },
  
  // ========== 较旧的 Ollama 模型（不支持或实验性支持）==========
  {
    pattern: '^llama2',
    capability: 'prompt',
    overrideProvider: true,
    note: 'Llama 2 不支持原生工具调用',
  },
  {
    pattern: '^codellama',
    capability: 'prompt',
    overrideProvider: true,
    note: 'CodeLlama 不支持原生工具调用',
  },
  {
    pattern: '^phi(?!3)',
    capability: 'prompt',
    overrideProvider: true,
    note: 'Phi 1/2 不支持原生工具调用',
  },
  
  // ========== 实验性支持 ==========
  {
    pattern: '^gemma',
    capability: 'experimental',
    overrideProvider: false,
    note: 'Gemma 工具调用支持为实验性',
  },
];

/**
 * 从 Provider 名称推断 Provider ID
 */
export function inferProviderId(providerName: string): string {
  const name = providerName.toLowerCase();
  
  // 精确匹配
  if (PROVIDER_CONFIGS[name]) return name;
  
  // 模糊匹配
  if (name.includes('openai') || name.includes('gpt')) return 'openai';
  if (name.includes('anthropic') || name.includes('claude')) return 'anthropic';
  if (name.includes('azure')) return 'azure';
  if (name.includes('google') || name.includes('gemini')) return 'google';
  if (name.includes('groq')) return 'groq';
  if (name.includes('mistral')) return 'mistral';
  if (name.includes('deepseek')) return 'deepseek';
  if (name.includes('together')) return 'together';
  if (name.includes('openrouter')) return 'openrouter';
  if (name.includes('orcarouter')) return 'orcarouter';
  if (name.includes('mixroute')) return 'mixroute';
  if (name.includes('novita')) return 'novita';
  if (name.includes('aihubmix')) return 'aihubmix';
  if (name.includes('lemonade')) return 'lemonade';
  if (name.includes('lmstudio') || name.includes('lm studio') || name.includes('lm-studio')) return 'lmstudio';
  if (name.includes('ollama')) return 'ollama';
  
  return 'unknown';
}

/**
 * 获取 Provider 配置
 */
export function getProviderConfig(providerName: string): ProviderToolCallConfig {
  const id = inferProviderId(providerName);
  return PROVIDER_CONFIGS[id] || PROVIDER_CONFIGS.unknown;
}

/**
 * 获取模型配置
 */
export function getModelConfig(modelName: string): ModelToolCallConfig | null {
  if (!modelName) return null;
  
  const lowerModel = modelName.toLowerCase();
  
  for (const config of MODEL_CONFIGS) {
    const regex = new RegExp(config.pattern, 'i');
    if (regex.test(lowerModel)) {
      return config;
    }
  }
  
  return null;
}

/**
 * 检测工具调用能力
 * 
 * 综合 Provider 配置和模型配置，返回最终的能力等级
 */
export function detectCapability(
  providerName: string,
  modelName?: string
): {
  capability: ToolCallCapability;
  source: 'model' | 'provider' | 'default';
  note?: string;
} {
  // 1. 检查模型特定配置
  if (modelName) {
    const modelConfig = getModelConfig(modelName);

    
    if (modelConfig && modelConfig.overrideProvider) {
      return {
        capability: modelConfig.capability,
        source: 'model',
        note: modelConfig.note,
      };
    }
  }
  
  // 2. 获取 Provider 配置
  const providerConfig = getProviderConfig(providerName);
  
  // 3. 如果模型配置存在但不覆盖 Provider，取更保守的能力
  if (modelName) {
    const modelConfig = getModelConfig(modelName);
    if (modelConfig) {
      // 如果模型能力低于 Provider 默认，使用模型能力
      const capabilityOrder: Record<ToolCallCapability, number> = {
        'native': 3,
        'experimental': 2,
        'prompt': 1,
        'none': 0,
      };
      
      if (capabilityOrder[modelConfig.capability] < capabilityOrder[providerConfig.defaultCapability]) {
        return {
          capability: modelConfig.capability,
          source: 'model',
          note: modelConfig.note,
        };
      }
    }
  }
  
  // 4. 返回 Provider 默认能力
  return {
    capability: providerConfig.defaultCapability,
    source: 'provider',
    note: providerConfig.note,
  };
}

/**
 * 获取所有 Provider 配置（用于 UI 显示）
 */
export function getAllProviderConfigs(): ProviderToolCallConfig[] {
  return Object.values(PROVIDER_CONFIGS).filter(c => c.id !== 'unknown');
}

/**
 * 获取所有模型配置（用于 UI 显示）
 */
export function getAllModelConfigs(): ModelToolCallConfig[] {
  return [...MODEL_CONFIGS];
}
