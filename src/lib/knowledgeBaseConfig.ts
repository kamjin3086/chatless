/**
 * 知识库配置管理服务
 * 负责知识库设置的保存、加载和验证
 */

export interface KnowledgeBaseConfig {
  // 向量存储配置
  vectorStore: {
    strategy: 'optimized_sqlite' | 'traditional_sqlite';
    performanceProfile: 'memory_optimized' | 'balanced' | 'performance';
    cacheSize: number;
    batchSize: number;
    enableParallelProcessing: boolean;
  };
  // 文档处理配置
  documentProcessing: {
    maxFileSize: number; // MB
    supportedFileTypes: string[];
    chunkSize: number;
    chunkOverlap: number;
    enableOCR: boolean;
    // —— 新增：LLM 上下文控制 ——
    autoAttachDocumentPreview: boolean; // 发送时是否自动拼接文档预览
    previewTokenLimit: number; // 预览的 token 上限
    previewKeepTailRatio: number; // 预览末尾保留比例 0~0.5
    // —— 新增：大文档判定阈值 ——
    bigFileSizeMb: number; // 触发索引引导的文件大小阈值
    bigTokenThreshold: number; // 触发索引引导的 token 估算阈值
  };
  // 检索配置
  retrieval: {
    topK: number;
    similarityThreshold: number;
    enableSemanticRanking: boolean;
    maxContextLength: number;
  };
  // 嵌入模型配置
  embedding: {
    strategy: 'ollama' | 'local-onnx';
    modelPath?: string;
    modelName?: string;
    tokenizerPath?: string;
    apiUrl?: string;
    dimensions: number;
    batchSize: number;
    timeout?: number;
    maxBatchSize?: number;
    maxLength?: number;
  };
  // 存储配置
  storage: {
    enableAutoCleanup: boolean;
    cleanupInterval: number; // 天
    enableBackup: boolean;
    backupInterval: number; // 小时
  };
}

// 默认配置
export const DEFAULT_KNOWLEDGE_BASE_CONFIG: KnowledgeBaseConfig = {
  vectorStore: {
    strategy: 'optimized_sqlite',
    performanceProfile: 'balanced',
    cacheSize: 256,
    batchSize: 100,
    enableParallelProcessing: true,
  },
  documentProcessing: {
    maxFileSize: 50,
    supportedFileTypes: ['pdf', 'docx', 'txt', 'md'],
    chunkSize: 1000,
    chunkOverlap: 200,
    enableOCR: false,
    autoAttachDocumentPreview: false,
    previewTokenLimit: 6000,
    previewKeepTailRatio: 0.2,
    bigFileSizeMb: 2,
    bigTokenThreshold: 4000,
  },
  retrieval: {
    topK: 5,
    similarityThreshold: 0.7,
    enableSemanticRanking: true,
    maxContextLength: 4000,
  },
  embedding: {
    strategy: 'local-onnx',
    modelPath: 'models/all-minilm-l6-v2', // 修正为正确的模型ID
    modelName: 'all-minilm-l6-v2', // 修正为正确的模型ID
    tokenizerPath: undefined,
    apiUrl: '',
    dimensions: 384,
    batchSize: 32,
    timeout: 10000,
    maxBatchSize: 128,
  },
  storage: {
    enableAutoCleanup: false,
    cleanupInterval: 30,
    enableBackup: true,
    backupInterval: 24,
  },
};

/**
 * 知识库配置管理器
 */
export class KnowledgeBaseConfigManager {
  private static readonly CONFIG_KEY = 'knowledge_base_config';
  private config: KnowledgeBaseConfig;
  private listeners: Array<(config: KnowledgeBaseConfig) => void> = [];

  /**
   * 用于追踪配置加载是否完成的 Promise
   * 在构造函数中立即启动，供外部等待
   */
  private readonly loadPromise: Promise<void>;

  constructor() {
    this.config = { ...DEFAULT_KNOWLEDGE_BASE_CONFIG };
    // 在构造函数中就开始异步加载配置，并保存 Promise 以便外部 await
    this.loadPromise = this.loadConfig();
  }

  /**
   * 等待配置加载完成
   */
  async ensureLoaded(): Promise<void> {
    // 如果加载过程抛出异常，这里继续向上抛出，调用方可自行处理
    await this.loadPromise;
  }

  /**
   * 加载配置
   */
  private async loadConfig(): Promise<void> {
    try {
      if (typeof window !== 'undefined') {
        // 浏览器环境：使用 Tauri Store 插件
        const { load } = await import('@tauri-apps/plugin-store');
        const store = await load('settings.json', { autoSave: false });
        const savedConfig = await store.get<KnowledgeBaseConfig>(KnowledgeBaseConfigManager.CONFIG_KEY);
        
        if (savedConfig) {
          this.config = this.validateAndMergeConfig(savedConfig);
        }
      }
    } catch (error) {
      console.warn('Failed to load knowledge base config:', error);
      // 使用默认配置
      this.config = { ...DEFAULT_KNOWLEDGE_BASE_CONFIG };
    }
  }

  /**
   * 保存配置
   */
  async saveConfig(config: KnowledgeBaseConfig): Promise<void> {
    try {
      // 验证配置
      const validatedConfig = this.validateAndMergeConfig(config);
      this.config = validatedConfig;

      if (typeof window !== 'undefined') {
        // 浏览器环境：使用 Tauri Store 插件
        const { load } = await import('@tauri-apps/plugin-store');
        const store = await load('settings.json', { autoSave: false });
        await store.set(KnowledgeBaseConfigManager.CONFIG_KEY, validatedConfig);
        await store.save();
      }

      // 通知监听器
      this.notifyListeners();
    } catch (error) {
      console.error('Failed to save knowledge base config:', error);
      throw new Error('保存知识库配置失败');
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): KnowledgeBaseConfig {
    return { ...this.config };
  }

  /**
   * 更新配置的特定部分
   */
  async updateConfig<K extends keyof KnowledgeBaseConfig>(
    section: K,
    updates: Partial<KnowledgeBaseConfig[K]>
  ): Promise<void> {
    const newConfig = {
      ...this.config,
      [section]: {
        ...this.config[section],
        ...updates,
      },
    };
    await this.saveConfig(newConfig);
  }

  /**
   * 重置为默认配置
   */
  async resetToDefault(): Promise<void> {
    await this.saveConfig({ ...DEFAULT_KNOWLEDGE_BASE_CONFIG });
  }

  /**
   * 添加配置变更监听器
   */
  addListener(listener: (config: KnowledgeBaseConfig) => void): void {
    this.listeners.push(listener);
  }

  /**
   * 移除配置变更监听器
   */
  removeListener(listener: (config: KnowledgeBaseConfig) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.getConfig());
      } catch (error) {
        console.error('Error in config listener:', error);
      }
    });
  }


  /**
   * 验证并合并配置
   */
  private validateAndMergeConfig(config: Partial<KnowledgeBaseConfig>): KnowledgeBaseConfig {
    const validatedConfig: KnowledgeBaseConfig = {
      ...DEFAULT_KNOWLEDGE_BASE_CONFIG,
      ...config,
    };

    // 验证向量存储配置
    if (config.vectorStore) {
      validatedConfig.vectorStore = {
        ...DEFAULT_KNOWLEDGE_BASE_CONFIG.vectorStore,
        ...config.vectorStore,
      };
      
      // 验证数值范围
      validatedConfig.vectorStore.cacheSize = Math.max(64, Math.min(2048, validatedConfig.vectorStore.cacheSize));
      validatedConfig.vectorStore.batchSize = Math.max(10, Math.min(1000, validatedConfig.vectorStore.batchSize));
    }

    // 验证文档处理配置
    if (config.documentProcessing) {
      validatedConfig.documentProcessing = {
        ...DEFAULT_KNOWLEDGE_BASE_CONFIG.documentProcessing,
        ...config.documentProcessing,
      };
      
      // 验证文件大小和分块参数
      validatedConfig.documentProcessing.maxFileSize = Math.max(1, Math.min(500, validatedConfig.documentProcessing.maxFileSize));
      validatedConfig.documentProcessing.chunkSize = Math.max(200, Math.min(4000, validatedConfig.documentProcessing.chunkSize));
      validatedConfig.documentProcessing.chunkOverlap = Math.max(0, Math.min(500, validatedConfig.documentProcessing.chunkOverlap));
    }

    // 验证检索配置
    if (config.retrieval) {
      validatedConfig.retrieval = {
        ...DEFAULT_KNOWLEDGE_BASE_CONFIG.retrieval,
        ...config.retrieval,
      };
      
      // 验证检索参数
      validatedConfig.retrieval.topK = Math.max(1, Math.min(20, validatedConfig.retrieval.topK));
      validatedConfig.retrieval.similarityThreshold = Math.max(0.1, Math.min(1.0, validatedConfig.retrieval.similarityThreshold));
      validatedConfig.retrieval.maxContextLength = Math.max(1000, Math.min(8000, validatedConfig.retrieval.maxContextLength));
    }

    // 验证嵌入模型配置
    if (config.embedding) {
      validatedConfig.embedding = {
        ...DEFAULT_KNOWLEDGE_BASE_CONFIG.embedding,
        ...config.embedding,
      };
      
      // 验证批处理大小
      validatedConfig.embedding.batchSize = Math.max(1, Math.min(128, validatedConfig.embedding.batchSize));
    }

    // 验证存储配置
    if (config.storage) {
      validatedConfig.storage = {
        ...DEFAULT_KNOWLEDGE_BASE_CONFIG.storage,
        ...config.storage,
      };
      
      // 验证清理和备份间隔
      validatedConfig.storage.cleanupInterval = Math.max(1, Math.min(365, validatedConfig.storage.cleanupInterval));
      validatedConfig.storage.backupInterval = Math.max(1, Math.min(168, validatedConfig.storage.backupInterval));
    }

    return validatedConfig;
  }

  /**
   * 导出配置为JSON
   */
  exportConfig(): string {
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * 从JSON导入配置
   */
  async importConfig(configJson: string): Promise<void> {
    try {
      const importedConfig = JSON.parse(configJson) as Partial<KnowledgeBaseConfig>;
      await this.saveConfig(this.validateAndMergeConfig(importedConfig));
    } catch {
      throw new Error('无效的配置文件格式');
    }
  }

  /**
   * 获取性能配置建议
   */
  getPerformanceRecommendation(documentsCount: number, memoryMB: number): Partial<KnowledgeBaseConfig> {
    if (documentsCount < 1000) {
      return {
        vectorStore: {
          ...this.config.vectorStore,
          performanceProfile: 'memory_optimized',
          cacheSize: Math.min(memoryMB * 0.1, 128),
          batchSize: 50,
        },
      };
    } else if (documentsCount < 10000) {
      return {
        vectorStore: {
          ...this.config.vectorStore,
          performanceProfile: 'balanced',
          cacheSize: Math.min(memoryMB * 0.2, 256),
          batchSize: 100,
        },
      };
    } else {
      return {
        vectorStore: {
          ...this.config.vectorStore,
          performanceProfile: 'performance',
          cacheSize: Math.min(memoryMB * 0.3, 512),
          batchSize: 200,
        },
      };
    }
  }
}

// 单例实例
let configManager: KnowledgeBaseConfigManager | null = null;

/**
 * 获取知识库配置管理器实例
 */
export function getKnowledgeBaseConfigManager(): KnowledgeBaseConfigManager {
  if (!configManager) {
    configManager = new KnowledgeBaseConfigManager();
  }
  return configManager;
}

/**
 * 便捷函数：获取当前配置
 */
export function getCurrentKnowledgeBaseConfig(): KnowledgeBaseConfig {
  return getKnowledgeBaseConfigManager().getConfig();
}

/**
 * 便捷函数：保存配置
 */
export async function saveKnowledgeBaseConfig(config: KnowledgeBaseConfig): Promise<void> {
  await getKnowledgeBaseConfigManager().saveConfig(config);
}

/**
 * 便捷函数：加载配置
 */
export async function loadKnowledgeBaseConfig(): Promise<KnowledgeBaseConfig> {
  const manager = getKnowledgeBaseConfigManager();
  // 等待配置实际加载完成，避免返回默认配置导致 UI 失效
  await manager.ensureLoaded();
  return manager.getConfig();
} 