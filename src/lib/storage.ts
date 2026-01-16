import { Store } from '@tauri-apps/plugin-store';

/**
 * 统一存储工具类
 * 封装Tauri Store插件，提供类似localStorage但更强大的API
 * 支持客户端/服务器端环境检查，自动JSON序列化/反序列化
 */
export class StorageUtil {
  private static stores: Map<string, Store> = new Map();
  private static readonly DEFAULT_STORE = 'app-storage.json';

  /**
   * 检查是否在客户端环境
   */
  private static isClientSide(): boolean {
    return typeof window !== 'undefined';
  }

  // 标记是否已输出过服务端上下文警告（避免重复日志）
  private static hasLoggedServerContext = false;

  /**
   * 获取或创建Store实例
   */
  private static async getStore(storeName: string = this.DEFAULT_STORE): Promise<Store | null> {
    if (!this.isClientSide()) {
      // 仅在首次时输出一次警告，避免日志刷屏
      if (!this.hasLoggedServerContext) {
        this.hasLoggedServerContext = true;
        console.debug('[Storage] 服务端上下文，存储操作已跳过');
      }
      return null;
    }

    if (!this.stores.has(storeName)) {
      try {
        const store = await Store.load(storeName);
        this.stores.set(storeName, store);
      } catch (error) {
        console.error(`Failed to load store ${storeName}:`, error);
        return null;
      }
    }

    return this.stores.get(storeName) || null;
  }

  /**
   * 设置数据到存储
   * @param key 键名
   * @param value 值（自动JSON序列化）
   * @param storeName 存储文件名（可选，默认为app-storage.json）
   */
  static async setItem<T = any>(key: string, value: T, storeName?: string): Promise<boolean> {
    try {
      const store = await this.getStore(storeName);
      if (!store) return false;

      await store.set(key, value);
      await store.save();
      
      console.debug(`Storage: Set ${key} in ${storeName || this.DEFAULT_STORE}`);
      return true;
    } catch (error) {
      console.error(`Failed to set ${key}:`, error);
      return false;
    }
  }

  /**
   * 从存储获取数据
   * @param key 键名
   * @param defaultValue 默认值
   * @param storeName 存储文件名（可选）
   */
  static async getItem<T = any>(key: string, defaultValue: T | null = null, storeName?: string): Promise<T | null> {
    try {
      const store = await this.getStore(storeName);
      if (!store) return defaultValue;

      const value = await store.get<T>(key);
      return value !== null && value !== undefined ? value : defaultValue;
    } catch (error) {
      console.error(`Failed to get ${key}:`, error);
      return defaultValue;
    }
  }

  /**
   * 删除存储中的数据
   * @param key 键名
   * @param storeName 存储文件名（可选）
   */
  static async removeItem(key: string, storeName?: string): Promise<boolean> {
    try {
      const store = await this.getStore(storeName);
      if (!store) return false;

      await store.delete(key);
      await store.save();
      
      console.debug(`Storage: Removed ${key} from ${storeName || this.DEFAULT_STORE}`);
      return true;
    } catch (error) {
      console.error(`Failed to remove ${key}:`, error);
      return false;
    }
  }

  /**
   * 清空整个存储
   * @param storeName 存储文件名（可选）
   */
  static async clear(storeName?: string): Promise<boolean> {
    try {
      const store = await this.getStore(storeName);
      if (!store) return false;

      await store.clear();
      await store.save();
      
      console.log(`Storage: Cleared ${storeName || this.DEFAULT_STORE}`);
      return true;
    } catch (error) {
      console.error(`Failed to clear storage:`, error);
      return false;
    }
  }

  /**
   * 获取所有键名
   * @param storeName 存储文件名（可选）
   */
  static async keys(storeName?: string): Promise<string[]> {
    try {
      const store = await this.getStore(storeName);
      if (!store) return [];

      return await store.keys();
    } catch (error) {
      console.error(`Failed to get keys:`, error);
      return [];
    }
  }

  /**
   * 检查键是否存在
   * @param key 键名
   * @param storeName 存储文件名（可选）
   */
  static async hasKey(key: string, storeName?: string): Promise<boolean> {
    try {
      const store = await this.getStore(storeName);
      if (!store) return false;

      return await store.has(key);
    } catch (error) {
      console.error(`Failed to check key ${key}:`, error);
      return false;
    }
  }

  /**
   * 获取存储大小（键的数量）
   * @param storeName 存储文件名（可选）
   */
  static async size(storeName?: string): Promise<number> {
    try {
      const store = await this.getStore(storeName);
      if (!store) return 0;

      return await store.length();
    } catch (error) {
      console.error(`Failed to get storage size:`, error);
      return 0;
    }
  }

  /**
   * 清理所有应用相关的存储数据
   * 包括 Tauri Store 和 localStorage 中与应用相关的数据
   */
  static async clearAllAppData(): Promise<{
    tauriStoresCleared: number;
    localStorageKeysCleared: number;
    errors: string[];
  }> {
    const result = {
      tauriStoresCleared: 0,
      localStorageKeysCleared: 0,
      errors: [] as string[]
    };

    try {
      // 1. 清理所有 Tauri Store 文件
      const appStoreFiles = [
        'app-storage.json',
        'sample-init-flag.json',
        'sample-lock.json',
        'llm-config.json',
        'ollama-models.json',
        'model-usage.json',
        'model-downloads.json',
        'model-manager.json',
        'file-list.json',
        'documents-index.json',
        'unified-files.json',
        'settings.json',
        'knowledge-config.json',
        'embedding-config.json',
        'user-preferences.json',
        // 新增：Provider/模型相关的持久化文件
        'provider-models.json',
        'provider-models-meta.json',
        'provider-status.json',
        'model-parameters.json',
        'session-parameters.json',
        'model-strategy.json'
      ];

      for (const storeFile of appStoreFiles) {
        try {
          const cleared = await this.clear(storeFile);
          if (cleared) {
            result.tauriStoresCleared++;
            console.log(`已清理 Tauri Store: ${storeFile}`);
          }
        } catch (storeError) {
          const errorMsg = `清理 Tauri Store ${storeFile} 失败: ${storeError}`;
          result.errors.push(errorMsg);
          console.warn(`⚠️ ${errorMsg}`);
        }
      }

      // 2. 清理应用相关的 localStorage 数据
      if (this.isClientSide()) {
        try {
          const keys = Object.keys(localStorage);
          const appKeys = keys.filter(key => 
            key.startsWith('knowledge_') || 
            key.startsWith('embedding_') ||
            key.startsWith('chat_') ||
            key === 'chat-store' || // Zustand 持久化默认键
            key.startsWith('sample_') ||
            key.includes('onnx') ||
            key.includes('ollama') ||
            key.includes('tauri') ||
            key.startsWith('app_')
          );
          
          for (const key of appKeys) {
            try {
              localStorage.removeItem(key);
              result.localStorageKeysCleared++;
            } catch (keyError) {
              const errorMsg = `清理 localStorage 键 ${key} 失败: ${keyError}`;
              result.errors.push(errorMsg);
              console.warn(`⚠️ ${errorMsg}`);
            }
          }
          
          console.log(`已清理 ${result.localStorageKeysCleared} 个 localStorage 项目`);
        } catch (localStorageError) {
          const errorMsg = `清理 localStorage 失败: ${localStorageError}`;
          result.errors.push(errorMsg);
          console.warn(`⚠️ ${errorMsg}`);
        }
      }

      console.log(`🧹 存储清理完成: Tauri Stores (${result.tauriStoresCleared}), localStorage 键 (${result.localStorageKeysCleared})`);
      if (result.errors.length > 0) {
        console.log(`⚠️ 清理过程中发生 ${result.errors.length} 个错误`);
      }

      return result;
    } catch (error) {
      const errorMsg = `清理应用存储数据失败: ${error}`;
      result.errors.push(errorMsg);
      console.error(errorMsg);
      return result;
    }
  }
}

/**
 * 兼容localStorage的简化API
 * 提供与localStorage相同的同步接口，但内部使用异步操作
 * 注意：由于Tauri Store是异步的，这些方法返回Promise
 */
export const storage = {
  /**
   * 设置字符串值（兼容localStorage.setItem）
   */
  setItem: (key: string, value: string) => StorageUtil.setItem(key, value),
  
  /**
   * 获取字符串值（兼容localStorage.getItem）
   */
  getItem: (key: string) => StorageUtil.getItem<string>(key, null),
  
  /**
   * 删除项目（兼容localStorage.removeItem）
   */
  removeItem: (key: string) => StorageUtil.removeItem(key),
  
  /**
   * 清空存储（兼容localStorage.clear）
   */
  clear: () => StorageUtil.clear(),
  
  /**
   * 获取键数量（兼容localStorage.length）
   */
  length: () => StorageUtil.size()
};

/**
 * 专用存储工具 - 为特定功能模块提供独立的存储空间
 */
export const specializedStorage = {
  /**
   * LLM配置存储
   */
  llm: {
    setApiKey: (provider: string, apiKey: string) => 
      StorageUtil.setItem(`${provider.toLowerCase()}_api_key`, apiKey, 'llm-config.json'),
    getApiKey: (provider: string) => 
      StorageUtil.getItem<string>(`${provider.toLowerCase()}_api_key`, null, 'llm-config.json'),
    removeApiKey: (provider: string) => 
      StorageUtil.removeItem(`${provider.toLowerCase()}_api_key`, 'llm-config.json'),
    setCache: (config: any) => 
      StorageUtil.setItem('llm_cache', config, 'llm-config.json'),
    getCache: () => 
      StorageUtil.getItem('llm_cache', null, 'llm-config.json'),
    clearCache: () => 
      StorageUtil.removeItem('llm_cache', 'llm-config.json'),
  },

  /**
   * 模型管理存储
   */
  models: {
    setOllamaModels: (models: string[]) => 
      StorageUtil.setItem('models', models, 'ollama-models.json'),
    getOllamaModels: () => 
      StorageUtil.getItem<string[]>('models', [], 'ollama-models.json'),

    /** 通用 Provider 模型缓存 */
    setProviderModels: (provider: string, models: string[]) =>
      StorageUtil.setItem(`${provider.toLowerCase()}_models`, models, 'provider-models.json'),
    getProviderModels: (provider: string) =>
      StorageUtil.getItem<string[]>(`${provider.toLowerCase()}_models`, [], 'provider-models.json'),
    setRecentModels: (pairs: Array<{ provider: string; modelId: string }>) => 
      StorageUtil.setItem('recentModels', pairs, 'model-usage.json'),
    getRecentModels: () => 
      StorageUtil.getItem<Array<{ provider: string; modelId: string }>>('recentModels', [], 'model-usage.json'),
    setDownloadedModels: (models: Set<string>) => 
      StorageUtil.setItem('onnx-downloaded-models', Array.from(models), 'model-downloads.json'),
    getDownloadedModels: async () => {
      const models = await StorageUtil.getItem<string[]>('onnx-downloaded-models', [], 'model-downloads.json');
      return new Set(models || []);
    },
    setModelManagerState: (state: any) => 
      StorageUtil.setItem('modelManagerState', state, 'model-manager.json'),
    getModelManagerState: () => 
      StorageUtil.getItem('modelManagerState', null, 'model-manager.json'),

    // 保存 provider + modelId 对，避免不同 provider 同名模型冲突
    setLastSelectedModelPair: (provider: string, modelId: string) =>
      StorageUtil.setItem('lastSelectedModelPair', { provider, modelId }, 'model-usage.json'),
    getLastSelectedModelPair: () =>
      StorageUtil.getItem<{ provider: string; modelId: string }>('lastSelectedModelPair', null, 'model-usage.json'),
    removeLastSelectedModelPair: () =>
      StorageUtil.removeItem('lastSelectedModelPair', 'model-usage.json'),

    // 每个会话固定选择（不改动数据库 schema 的前提下）
    setConversationSelectedModel: (conversationId: string, provider: string, modelId: string) =>
      StorageUtil.setItem(`conv_${conversationId}_selected_model`, { provider, modelId }, 'model-usage.json'),
    getConversationSelectedModel: (conversationId: string) =>
      StorageUtil.getItem<{ provider: string; modelId: string }>(`conv_${conversationId}_selected_model`, null, 'model-usage.json'),
    removeConversationSelectedModel: (conversationId: string) =>
      StorageUtil.removeItem(`conv_${conversationId}_selected_model`, 'model-usage.json'),

            // 模型参数配置存储
        setModelParameters: (providerName: string, modelId: string, parameters: any) => {
          const key = `${providerName.toLowerCase()}_${modelId.toLowerCase()}_params`;
          return StorageUtil.setItem(key, parameters, 'model-parameters.json');
        },
        getModelParameters: (providerName: string, modelId: string) => {
          const key = `${providerName.toLowerCase()}_${modelId.toLowerCase()}_params`;
          return StorageUtil.getItem(key, null, 'model-parameters.json');
        },
        getAllModelParameters: () => {
          return StorageUtil.keys('model-parameters.json');
        },
        removeModelParameters: (providerName: string, modelId: string) => {
          const key = `${providerName.toLowerCase()}_${modelId.toLowerCase()}_params`;
          return StorageUtil.removeItem(key, 'model-parameters.json');
        },
        
        // 会话参数配置存储
        setSessionParameters: (conversationId: string, parameters: any) => {
          const key = `session_${conversationId}_params`;
          return StorageUtil.setItem(key, parameters, 'session-parameters.json');
        },
        getSessionParameters: (conversationId: string) => {
          const key = `session_${conversationId}_params`;
          return StorageUtil.getItem(key, null, 'session-parameters.json');
        },
        getAllSessionParameters: () => {
          return StorageUtil.keys('session-parameters.json');
        },
        removeSessionParameters: (conversationId: string) => {
          const key = `session_${conversationId}_params`;
          return StorageUtil.removeItem(key, 'session-parameters.json');
        },

        // —— 模型显示名（label）重命名覆盖 ——
        setModelLabel: async (providerName: string, modelId: string, label: string) => {
          const key = `${providerName.toLowerCase()}_model_labels`;
          const record = (await StorageUtil.getItem<Record<string, string>>(key, {}, 'provider-models-meta.json')) || {};
          record[modelId] = label;
          return StorageUtil.setItem(key, record, 'provider-models-meta.json');
        },
        getModelLabels: (providerName: string) => {
          const key = `${providerName.toLowerCase()}_model_labels`;
          return StorageUtil.getItem<Record<string, string>>(key, {}, 'provider-models-meta.json');
        },
        removeModelLabel: async (providerName: string, modelId: string) => {
          const key = `${providerName.toLowerCase()}_model_labels`;
          const record = (await StorageUtil.getItem<Record<string, string>>(key, {}, 'provider-models-meta.json')) || {};
          delete record[modelId];
          return StorageUtil.setItem(key, record, 'provider-models-meta.json');
        },

        // —— 模型请求策略（per-provider、per-model）——
        setModelStrategy: (providerName: string, modelId: string, strategy: 'openai' | 'openai-responses' | 'openai-compatible' | 'anthropic' | 'gemini' | 'deepseek') => {
          const key = `${providerName.toLowerCase()}_${modelId.toLowerCase()}_strategy`;
          return StorageUtil.setItem(key, strategy, 'model-strategy.json');
        },
        getModelStrategy: (providerName: string, modelId: string) => {
          const key = `${providerName.toLowerCase()}_${modelId.toLowerCase()}_strategy`;
          return StorageUtil.getItem<string>(key, null, 'model-strategy.json');
        },
        removeModelStrategy: (providerName: string, modelId: string) => {
          const key = `${providerName.toLowerCase()}_${modelId.toLowerCase()}_strategy`;
          return StorageUtil.removeItem(key, 'model-strategy.json');
        },
        setProviderDefaultStrategy: (providerName: string, strategy: 'openai' | 'openai-responses' | 'openai-compatible' | 'anthropic' | 'gemini' | 'deepseek') => {
          const key = `${providerName.toLowerCase()}_default_strategy`;
          return StorageUtil.setItem(key, strategy, 'model-strategy.json');
        },
        getProviderDefaultStrategy: (providerName: string) => {
          const key = `${providerName.toLowerCase()}_default_strategy`;
          return StorageUtil.getItem<string>(key, null, 'model-strategy.json');
        },
        removeProviderDefaultStrategy: (providerName: string) => {
          const key = `${providerName.toLowerCase()}_default_strategy`;
          return StorageUtil.removeItem(key, 'model-strategy.json');
        },

        // —— Provider 模型获取调试规则 ——
        /**
         * 保存指定 Provider 的模型获取调试规则
         * 规则示例：
         * {
         *   useV1: true,
         *   endpointSuffix: "/models",
         *   modelsArrayPath: "data",            // JSON 路径（点号语法）
         *   idPath: "id",                        // 相对 item 的路径
         *   labelPath: "name"                    // 可选
         * }
         */
        setProviderFetchDebugRule: (providerName: string, rule: any) => {
          const key = `${providerName.toLowerCase()}_fetch_rule`;
          return StorageUtil.setItem(key, rule, 'model-fetch-debug.json');
        },
        /** 读取指定 Provider 的模型获取调试规则 */
        getProviderFetchDebugRule: (providerName: string) => {
          const key = `${providerName.toLowerCase()}_fetch_rule`;
          return StorageUtil.getItem<any>(key, null, 'model-fetch-debug.json');
        },
        /** 删除指定 Provider 的模型获取调试规则 */
        removeProviderFetchDebugRule: (providerName: string) => {
          const key = `${providerName.toLowerCase()}_fetch_rule`;
          return StorageUtil.removeItem(key, 'model-fetch-debug.json');
        },

        /** 保存调试获取的最新结果（仅用于开发调试记录） */
        setProviderFetchDebugResult: (providerName: string, models: Array<{ name: string; label?: string }>) => {
          const key = `${providerName.toLowerCase()}_fetch_result`;
          return StorageUtil.setItem(key, models, 'model-fetch-debug.json');
        },
        /** 读取调试获取的最新结果 */
        getProviderFetchDebugResult: (providerName: string) => {
          const key = `${providerName.toLowerCase()}_fetch_result`;
          return StorageUtil.getItem<Array<{ name: string; label?: string }>>(key, [], 'model-fetch-debug.json');
        },
  },

  /**
   * 文档和文件存储
   */
  documents: {
    setFileList: (files: any[]) => 
      StorageUtil.setItem('files', files, 'file-list.json'),
    getFileList: () => 
      StorageUtil.getItem<any[]>('files', [], 'file-list.json'),
    setDocumentIndex: (documents: any[]) => 
      StorageUtil.setItem('documents', documents, 'documents-index.json'),
    getDocumentIndex: () => 
      StorageUtil.getItem<any[]>('documents', [], 'documents-index.json'),
  },

  /**
   * 示例数据管理存储
   */
  sampleData: {
    // 初始化状态管理
    setInitialized: (value: boolean) => 
      StorageUtil.setItem('sample', value, 'sample-init-flag.json'),
    getInitialized: () => 
      StorageUtil.getItem<boolean>('sample', false, 'sample-init-flag.json'),
    clearInitialized: () => 
      StorageUtil.removeItem('sample', 'sample-init-flag.json'),
    
    // 初始化锁管理
    setLock: (timestamp: string) => 
      StorageUtil.setItem('sample_data_initializing', timestamp, 'sample-lock.json'),
    getLock: () => 
      StorageUtil.getItem<string>('sample_data_initializing', null, 'sample-lock.json'),
    clearLock: () => 
      StorageUtil.removeItem('sample_data_initializing', 'sample-lock.json'),
    
    // 检查锁是否过期（超过10分钟）
    isLockExpired: async () => {
      const lockTime = await StorageUtil.getItem<string>('sample_data_initializing', null, 'sample-lock.json');
      if (!lockTime) return true; // 没有锁，认为已过期
      
      const now = Date.now();
      const lockTimestamp = parseInt(lockTime);
      const maxLockDuration = 10 * 60 * 1000; // 10分钟
      
      return (now - lockTimestamp) > maxLockDuration;
    },
    
    // 强制清除锁（用于开发工具）
    forceClearLock: async () => {
      console.log('🔓 强制清除示例数据初始化锁');
      return StorageUtil.removeItem('sample_data_initializing', 'sample-lock.json');
    }
  },

  /**
   * Provider 状态缓存
   * key: provider_name_status
   */
  providers: {
    setStatus: (provider: string, status: {
      isConnected: boolean;
      displayStatus: string;
      statusTooltip: string;
      cachedAt?: number;
    }) => {
      return StorageUtil.setItem(`${provider.toLowerCase()}_status`, { ...status, cachedAt: Date.now() }, 'provider-status.json');
    },
    getStatus: (provider: string) => {
      return StorageUtil.getItem<any>(`${provider.toLowerCase()}_status`, null, 'provider-status.json');
    }
  }
};

export default StorageUtil; 