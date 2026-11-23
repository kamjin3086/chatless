/**
 * 嵌入模型管理服务
 * 负责模型下载、状态管理和策略切换
 */

import { OllamaConfigService } from '@/lib/config/OllamaConfigService';
import modelsConfig from '@/lib/models.json';
import { tauriFetch } from '@/lib/request';

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  /** English description for the English interface; falls back to `description`. */
  descriptionEn?: string;
  size: string;
  strategy: 'ollama' | 'local-onnx';
  downloadUrl?: string;
  fileName?: string;
  tokenizerUrl?: string;
  tokenizerFileName?: string;
  dimensions?: number;
  isDownloaded: boolean;
  isDownloading: boolean;
  downloadProgress: number;
  isActive: boolean;
  isRecommended?: boolean;
  category?: string;
}

export interface ModelDownloadProgress {
  modelId: string;
  progress: number;
  speed?: string;
  eta?: string;
  status: 'downloading' | 'completed' | 'error' | 'cancelled';
  error?: string;
}

export class ModelManager {
  private models: Map<string, ModelInfo> = new Map();
  private downloadAbortControllers: Map<string, AbortController> = new Map();
  private progressCallbacks: Map<string, (progress: ModelDownloadProgress) => void> = new Map();
  private ollamaUrl: string = 'http://localhost:11434'; // 默认值，将在首次使用时动态更新
  private isOllamaUrlInitialized: boolean = false;

  constructor() {
    // 从配置文件初始化模型
    this.initializeModelsFromConfig();
    this.loadState();
    // 异步初始化URL，不阻塞构造函数
    this.initializeOllamaUrl().catch(error => {
      console.warn('[ModelManager] 构造函数中初始化 Ollama URL 失败:', error);
    });
  }

  /**
   * 从配置文件初始化模型
   */
  private initializeModelsFromConfig(): void {
    modelsConfig.forEach(config => {
      const model: ModelInfo = {
        id: config.id,
        name: config.name,
        description: config.description,
        descriptionEn: (config as { descriptionEn?: string }).descriptionEn,
        size: config.size,
        strategy: config.strategy as 'local-onnx' | 'ollama',
        downloadUrl: config.downloadUrl,
        fileName: config.fileName,
        tokenizerUrl: (config as any).tokenizerUrl,
        tokenizerFileName: (config as any).tokenizerFileName,
        dimensions: (config as any).dimensions,
        isDownloaded: false,
        isDownloading: false,
        downloadProgress: 0,
        isActive: false,
        isRecommended: config.isRecommended,
        category: config.category,
      };
      this.models.set(model.id, model);
    });
    console.log(`[ModelManager] 从配置文件加载了 ${this.models.size} 个模型`);
  }

  /**
   * 初始化 Ollama URL
   */
  private async initializeOllamaUrl(): Promise<void> {
    if (this.isOllamaUrlInitialized) {
      return; // 避免重复初始化
    }
    
    try {
      const { OllamaConfigService } = await import('@/lib/config/OllamaConfigService');
      this.ollamaUrl = await OllamaConfigService.getOllamaUrl();
      this.isOllamaUrlInitialized = true;
      console.log(`[ModelManager] 初始化 Ollama URL: ${this.ollamaUrl}`);
    } catch (error) {
      console.error('[ModelManager] 初始化 Ollama URL 失败:', error);
    }
  }

  /**
   * 更新 Ollama URL（当用户修改配置时调用）
   */
  async updateOllamaUrl(): Promise<void> {
    this.isOllamaUrlInitialized = false; // 重置初始化状态，强制更新
    await this.initializeOllamaUrl();
  }

  /**
   * 获取所有模型
   */
  getAllModels(): ModelInfo[] {
    return Array.from(this.models.values());
  }

  /**
   * 按策略获取模型
   */
  getModelsByStrategy(strategy: 'local-onnx' | 'ollama'): ModelInfo[] {
    return this.getAllModels().filter(model => model.strategy === strategy);
  }

  /**
   * 按分类获取模型
   */
  getModelsByCategory(category: string): ModelInfo[] {
    return this.getAllModels().filter(model => model.category === category);
  }

  /**
   * 获取推荐模型
   */
  getRecommendedModels(): ModelInfo[] {
    return this.getAllModels().filter(model => model.isRecommended);
  }

  /**
   * 获取特定模型
   */
  getModel(modelId: string): ModelInfo | undefined {
    return this.models.get(modelId);
  }

  /**
   * 获取当前激活的模型
   */
  getActiveModel(): ModelInfo | undefined {
    return this.getAllModels().find(model => model.isActive);
  }

  /**
   * 设置激活模型
   */
  async setActiveModel(modelId: string): Promise<void> {
    // 先取消所有模型的激活状态
    this.models.forEach(model => {
      model.isActive = false;
    });

    // 激活指定模型
    const model = this.models.get(modelId);
    if (model && model.isDownloaded) {
      model.isActive = true;
      await this.saveState();
    } else {
      throw new Error('模型未下载或不存在');
    }
  }

  /**
   * 下载模型
   */
  async downloadModel(
    modelId: string,
    onProgress?: (progress: ModelDownloadProgress) => void
  ): Promise<void> {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error('模型不存在');
    }

    if (model.isDownloaded) {
      throw new Error('模型已下载');
    }

    if (model.isDownloading) {
      throw new Error('模型正在下载中');
    }

    // 设置下载状态
    model.isDownloading = true;
    model.downloadProgress = 0;

    if (onProgress) {
      this.progressCallbacks.set(modelId, onProgress);
    }

    try {
      if (model.strategy === 'local-onnx') {
        await this.downloadOnnxModel(model);
      } else if (model.strategy === 'ollama') {
        await this.downloadOllamaModel(model);
      }

      model.isDownloaded = true;
      model.isDownloading = false;
      model.downloadProgress = 100;

      // 如果这是第一个下载的模型，自动设为激活
      if (!this.getActiveModel()) {
        await this.setActiveModel(modelId);
      }

      await this.saveState();

      // 通知下载完成
      if (onProgress) {
        onProgress({
          modelId,
          progress: 100,
          status: 'completed'
        });
      }
    } catch (error) {
      model.isDownloading = false;
      model.downloadProgress = 0;

      if (onProgress) {
        onProgress({
          modelId,
          progress: 0,
          status: 'error',
          error: error instanceof Error ? error.message : String(error)
        });
      }

      throw error;
    } finally {
      this.downloadAbortControllers.delete(modelId);
      this.progressCallbacks.delete(modelId);
    }
  }

  /**
   * 取消下载
   */
  cancelDownload(modelId: string): void {
    const controller = this.downloadAbortControllers.get(modelId);
    if (controller) {
      controller.abort();
    }

    const model = this.models.get(modelId);
    if (model) {
      model.isDownloading = false;
      model.downloadProgress = 0;
    }

    const callback = this.progressCallbacks.get(modelId);
    if (callback) {
      callback({
        modelId,
        progress: 0,
        status: 'cancelled'
      });
    }
  }

  /**
   * 删除模型
   */
  async deleteModel(modelId: string): Promise<void> {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error('模型不存在');
    }

    if (model.isDownloading) {
      this.cancelDownload(modelId);
    }

    try {
      if (model.strategy === 'local-onnx' && model.fileName) {
        // 删除本地文件
        await this.deleteOnnxModelFile(model.fileName);
      } else if (model.strategy === 'ollama') {
        // 通过Ollama API删除模型
        await this.deleteOllamaModel(model.id);
      }

      model.isDownloaded = false;
      model.isActive = false;
      model.downloadProgress = 0;

      await this.saveState();
    } catch (error) {
      console.error('删除模型失败:', error);
      throw error;
    }
  }

  /**
   * 检查模型状态
   */
  async checkModelStatus(): Promise<void> {
    for (const model of this.models.values()) {
      try {
        if (model.strategy === 'local-onnx') {
          model.isDownloaded = await this.checkOnnxModelExists(model.fileName || '');
        } else if (model.strategy === 'ollama') {
          model.isDownloaded = await this.checkOllamaModelExists(model.id);
        }
      } catch (error) {
        console.warn(`检查模型 ${model.id} 状态失败:`, error);
        model.isDownloaded = false;
      }
    }
    await this.saveState();
  }

  /**
   * 下载ONNX模型
   */
  private async downloadOnnxModel(model: ModelInfo): Promise<void> {
    if (!model.downloadUrl || !model.fileName) {
      throw new Error('模型下载信息不完整');
    }

    const controller = new AbortController();
    this.downloadAbortControllers.set(model.id, controller);

    try {
      const response = await fetch(model.downloadUrl, {
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`下载失败: ${response.status} ${response.statusText}`);
      }

      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength) : 0;
      let loaded = 0;

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法读取响应流');
      }

      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        loaded += value.length;

        if (total > 0) {
          const progress = Math.round((loaded / total) * 100);
          model.downloadProgress = progress;

          const callback = this.progressCallbacks.get(model.id);
          if (callback) {
            callback({
              modelId: model.id,
              progress,
              status: 'downloading'
            });
          }
        }
      }

      // 保存文件到浏览器存储
      const blob = new Blob(chunks);
      await this.saveModelToStorage(model.fileName, blob);

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('下载已取消');
      }
      throw error;
    }
  }

  /**
   * 下载Ollama模型
   */
  private async downloadOllamaModel(model: ModelInfo): Promise<void> {
    try {
      // 确保使用最新的 Ollama URL
      await this.initializeOllamaUrl();
      
      console.log(`[ModelManager] 使用 Ollama URL 下载模型: ${this.ollamaUrl}`);
      
      // 通过Ollama API拉取模型
      const response = await fetch(`${this.ollamaUrl}/api/pull`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: model.id,
          stream: true
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API错误: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法读取响应流');
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = new TextDecoder().decode(value);
        const lines = text.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.status && data.total && data.completed) {
              const progress = Math.round((data.completed / data.total) * 100);
              model.downloadProgress = progress;

              const callback = this.progressCallbacks.get(model.id);
              if (callback) {
                callback({
                  modelId: model.id,
                  progress,
                  status: 'downloading'
                });
              }
            }
          } catch (e) {
            // 忽略JSON解析错误
          }
        }
      }
    } catch (error) {
      throw new Error(`Ollama模型下载失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 检查ONNX模型是否存在
   */
  private async checkOnnxModelExists(fileName: string): Promise<boolean> {
    try {
      // 检查浏览器存储中是否存在文件
      return await this.checkModelInStorage(fileName);
    } catch {
      return false;
    }
  }

  /**
   * 检查Ollama模型是否存在
   */
  private async checkOllamaModelExists(modelId: string): Promise<boolean> {
    try {
      // 确保 Ollama URL 已初始化
      await this.initializeOllamaUrl();
      
      console.log(`[ModelManager] 检查 Ollama 模型 ${modelId}，使用 URL: ${this.ollamaUrl}`);
      
      const response = await tauriFetch(`${this.ollamaUrl}/api/tags`, {
        method: 'GET',
        danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
        fallbackToBrowserOnError: true,
        verboseDebug: true,
        debugTag: 'ModelList',
      });
      if (!response.ok) return false;

      const data = await response.json();
      const models = data.models || [];
      return models.some((model: any) => model.name === modelId);
    } catch (error) {
      console.error(`[ModelManager] 检查 Ollama 模型失败:`, error);
      return false;
    }
  }

  /**
   * 保存模型到浏览器存储
   */
  private async saveModelToStorage(fileName: string, blob: Blob): Promise<void> {
    // 使用IndexedDB存储大文件
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('ModelStorage', 1);
      
      request.onerror = () => reject(request.error);
      
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['models'], 'readwrite');
        const store = transaction.objectStore('models');
        
        store.put(blob, fileName);
        
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      };
      
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('models')) {
          db.createObjectStore('models');
        }
      };
    });
  }

  /**
   * 检查模型在存储中是否存在
   */
  private async checkModelInStorage(fileName: string): Promise<boolean> {
    return new Promise((resolve) => {
      const request = indexedDB.open('ModelStorage', 1);
      
      request.onerror = () => resolve(false);
      
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['models'], 'readonly');
        const store = transaction.objectStore('models');
        const getRequest = store.get(fileName);
        
        getRequest.onsuccess = () => {
          resolve(getRequest.result !== undefined);
        };
        
        getRequest.onerror = () => resolve(false);
      };
      
      request.onupgradeneeded = () => {
        resolve(false);
      };
    });
  }

  /**
   * 删除ONNX模型文件
   */
  private async deleteOnnxModelFile(fileName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('ModelStorage', 1);
      
      request.onerror = () => reject(request.error);
      
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['models'], 'readwrite');
        const store = transaction.objectStore('models');
        
        store.delete(fileName);
        
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }

  /**
   * 删除Ollama模型
   */
  private async deleteOllamaModel(modelId: string): Promise<void> {
    // 确保 Ollama URL 已初始化
    await this.initializeOllamaUrl();
    
    console.log(`[ModelManager] 删除 Ollama 模型 ${modelId}，使用 URL: ${this.ollamaUrl}`);
    
    const response = await fetch(`${this.ollamaUrl}/api/delete`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: modelId
      })
    });

    if (!response.ok) {
      throw new Error(`删除Ollama模型失败: ${response.status}`);
    }
  }

  /**
   * 保存状态到存储
   */
  private async saveState(): Promise<void> {
    try {
      const state = {
        models: Object.fromEntries(this.models.entries()),
        lastUpdated: Date.now()
      };
      
      const { specializedStorage } = await import('@/lib/storage');
      await specializedStorage.models.setModelManagerState(state);
    } catch (error) {
      console.error('保存ModelManager状态失败:', error);
    }
  }

  /**
   * 从存储加载状态
   */
  private async loadState(): Promise<void> {
    try {
      const { specializedStorage } = await import('@/lib/storage');
      const state = await specializedStorage.models.getModelManagerState();
      
      if (state && (state as any).models) {
        // 合并存储的状态和内置模型信息
        Object.entries((state as any).models).forEach(([id, storedModel]: [string, any]) => {
          const model = this.models.get(id);
          if (model) {
            model.isDownloaded = storedModel.isDownloaded || false;
            model.isActive = storedModel.isActive || false;
            model.downloadProgress = storedModel.downloadProgress || 0;
          }
        });
        console.log('从存储加载ModelManager状态');
      }
    } catch (error) {
      console.error('加载ModelManager状态失败:', error);
    }
  }
}

// 单例实例
let modelManagerInstance: ModelManager | null = null;

export function getModelManager(): ModelManager {
  if (!modelManagerInstance) {
    modelManagerInstance = new ModelManager();
  }
  return modelManagerInstance;
} 