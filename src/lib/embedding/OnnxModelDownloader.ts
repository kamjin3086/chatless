import { mkdir, exists, remove } from '@tauri-apps/plugin-fs';
import { download } from '@tauri-apps/plugin-upload';
import { appDataDir, join, dirname } from '@tauri-apps/api/path';
// 导入统一的模型配置
import modelsConfig from '@/lib/models.json';

export interface ModelDownloadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export interface OnnxModelInfo {
  id: string;
  name: string;
  downloadUrl: string;
  fileName: string;
  tokenizerUrl: string;
  tokenizerFileName: string;
  size: number;
  dimensions: number;
}

export class OnnxModelDownloader {
  private downloadedModels: Set<string> = new Set();
  private readyPromise: Promise<void>;

  constructor() {
    this.readyPromise = this.loadDownloadedModels();
  }

  /**
   * 从统一配置获取ONNX模型列表
   */
  private getAvailableOnnxModels(): OnnxModelInfo[] {
    return modelsConfig
      .filter(config => config.strategy === 'local-onnx' && config.downloadUrl && config.fileName)
      .map(config => ({
        id: config.id,
        name: config.name,
        downloadUrl: config.downloadUrl!,
        fileName: config.fileName!,
        // 使用配置中的 tokenizerUrl，如果没有则生成
        tokenizerUrl: (config as any).tokenizerUrl || config.downloadUrl!.replace('/model.onnx', '/tokenizer.json').replace(config.fileName!, 'tokenizer.json'),
        tokenizerFileName: (config as any).tokenizerFileName || 'tokenizer.json',
        // 解析文件大小（从字符串转换为字节）
        size: this.parseSizeToBytes(config.size),
        // 使用配置中的维度，如果没有则默认384
        dimensions: (config as any).dimensions || 384
      }));
  }

  /**
   * 将大小字符串转换为字节数
   */
  private parseSizeToBytes(sizeStr: string): number {
    const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(KB|MB|GB)$/i);
    if (!match) return 90 * 1024 * 1024; // 默认90MB
    
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    
    switch (unit) {
      case 'KB': return value * 1024;
      case 'MB': return value * 1024 * 1024;
      case 'GB': return value * 1024 * 1024 * 1024;
      default: return value;
    }
  }

  /**
   * 从统一存储加载已下载的模型列表
   */
  private async loadDownloadedModels(): Promise<void> {
    try {
      const { specializedStorage } = await import('@/lib/storage');
      this.downloadedModels = await specializedStorage.models.getDownloadedModels();
    } catch (error) {
      console.error('加载已下载模型列表失败:', error);
      this.downloadedModels = new Set();
    }
  }

  /**
   * 保存已下载的模型列表到统一存储
   */
  private async saveDownloadedModels(): Promise<void> {
    try {
      const { specializedStorage } = await import('@/lib/storage');
      await specializedStorage.models.setDownloadedModels(this.downloadedModels);
    } catch (error) {
      console.error('保存已下载模型列表失败:', error);
    }
  }

  async waitUntilReady(): Promise<void> {
    return this.readyPromise;
  }

  isModelDownloaded(modelId: string): boolean {
    return this.downloadedModels.has(modelId);
  }

  /**
   * 获取模型信息
   */
  getModelInfo(modelId: string): OnnxModelInfo | undefined {
    return this.getAvailableOnnxModels().find(model => model.id === modelId);
  }

  /**
   * 获取所有可用模型
   */
  getAvailableModels(): OnnxModelInfo[] {
    return this.getAvailableOnnxModels();
  }

  /**
   * 临时占位：为 WebEmbeddingStrategy 提供 getModelBlobUrl，
   * 当前桌面环境下直接返回 null 即可。
   * 如果将来在浏览器环境直接加载模型文件，可实现真实逻辑。
   */
  async getModelBlobUrl(modelId: string): Promise<string | null> {
    try {
      const paths = await this.getModelPaths(modelId);
      if (!paths) return null;
      // Desktop/Tauri 无需 blob URL，返回 file scheme 亦可
      return `file://${paths.model}`;
    } catch {
      return null;
    }
  }

  /**
   * 下载模型和分词器文件，并保存到磁盘
   */
  async downloadModel(
    modelId: string, 
    onProgress?: (progress: ModelDownloadProgress) => void
  ): Promise<void> {
    const modelInfo = this.getModelInfo(modelId);
    if (!modelInfo) {
      throw new Error(`Unknown model: ${modelId}`);
    }

    if (this.isModelDownloaded(modelId)) {
      console.log(`Model ${modelId} is already downloaded`);
      return;
    }

    try {
      console.log(`开始下载模型: ${modelInfo.name}`);
      
      if (onProgress) {
        onProgress({ loaded: 0, total: 1, percentage: 0 });
      }

      const modelPath = await OnnxModelDownloader.getModelFilePath(modelId, modelInfo.fileName);
      const tokenizerPath = await OnnxModelDownloader.getModelFilePath(modelId, modelInfo.tokenizerFileName);

      console.log(`准备下载模型: ${modelInfo.downloadUrl} -> ${modelPath}`);
      await OnnxModelDownloader.downloadFile(modelInfo.downloadUrl, modelPath, ({ progress, total }) => {
        if (!onProgress) return;
        // Fallback: 如果 total 为 0, 使用已知模型大小估算
        const effectiveTotal = total || modelInfo.size;
        const ratio = effectiveTotal ? progress / effectiveTotal : 0;
        const modelProgress = Math.min(80, Math.round(ratio * 80));
        console.log(`[模型下载] bytes=${progress}/${effectiveTotal} => ${modelProgress}%`);
        onProgress({ loaded: progress, total: effectiveTotal, percentage: modelProgress });
      });

      console.log(`准备下载分词器: ${modelInfo.tokenizerUrl} -> ${tokenizerPath}`);
      await OnnxModelDownloader.downloadFile(modelInfo.tokenizerUrl, tokenizerPath, ({ progress, total }) => {
        if (!onProgress) return;
        // 估算 tokenizer 文件大小，若 total 为 0 假设 5MB
        const EST_TOKENIZER_TOTAL = 5 * 1024 * 1024;
        const effectiveTotal = total || EST_TOKENIZER_TOTAL;
        const ratio = effectiveTotal ? progress / effectiveTotal : 0;
        const tokenizerProgress = 80 + Math.min(20, Math.round(ratio * 20));
        console.log(`[分词器下载] bytes=${progress}/${effectiveTotal} => ${tokenizerProgress}%`);
        onProgress({ loaded: progress, total: effectiveTotal, percentage: tokenizerProgress });
      });

      this.downloadedModels.add(modelId);
      await this.saveDownloadedModels();
      const { loadKnowledgeBaseConfig } = await import('@/lib/knowledgeBaseConfig');
      const selected = (await loadKnowledgeBaseConfig()).embedding;
      if (selected.strategy === 'local-onnx' && selected.modelName === modelId) {
        const { refreshRAGService } = await import('@/lib/rag/ragServiceInstance');
        await refreshRAGService();
      }
      console.log(`模型和分词器下载完成: ${modelInfo.name}`);
      
    } catch (error) {
      console.error(`模型下载失败: ${modelInfo.name}`, error);
      throw error;
    }
  }

  /**
   * 获取模型文件的物理路径
   * @returns {model: string, tokenizer: string}
   */
  async getModelPaths(modelId: string): Promise<{ model: string; tokenizer: string } | null> {
    if (!this.isModelDownloaded(modelId)) return null;

    const modelInfo = this.getModelInfo(modelId);
    if (!modelInfo) return null;

    const modelDir = await this.getModelDirectory(modelId);
    const modelPath = await join(modelDir, modelInfo.fileName);
    const tokenizerPath = await join(modelDir, modelInfo.tokenizerFileName);

    // 确认文件真实存在
    if (await exists(modelPath) && await exists(tokenizerPath)) {
      return { model: modelPath, tokenizer: tokenizerPath };
    } else {
      // 如果文件不存在，可能数据已损坏或被删除
      this.downloadedModels.delete(modelId);
      await this.saveDownloadedModels();
      return null;
    }
  }
  
  /**
   * 获取模型专属目录的路径
   */
  private async getModelDirectory(modelId: string, createIfNotExists = false): Promise<string> {
    const modelsDir = await join(await appDataDir(), 'models');
    if (createIfNotExists && !(await exists(modelsDir))) {
      await this.createDir(modelsDir);
    }

    const modelDir = await join(modelsDir, modelId);
    if (createIfNotExists && !(await exists(modelDir))) {
      await this.createDir(modelDir);
    }

    return modelDir;
  }
  
  /**
   * 删除模型文件
   */
  async deleteModel(modelId: string): Promise<void> {
    const modelDir = await this.getModelDirectory(modelId);
    if (await exists(modelDir)) {
      // 递归删除整个模型目录
      await remove(modelDir, { recursive: true });
    }
    this.downloadedModels.delete(modelId);
    await this.saveDownloadedModels();
    console.log(`模型 ${modelId} 已删除.`);
  }

  /**
   * 删除所有已下载的模型
   */
  async deleteAllModels(): Promise<void> {
    const models = Array.from(this.downloadedModels);
    for (const id of models) {
      try {
        await this.deleteModel(id);
      } catch (e) {
        console.warn(`删除模型 ${id} 失败`, e);
      }
    }
  }

  static async getModelFilePath(modelId: string, fileName: string): Promise<string> {
    const modelDir = await this.getModelDir(modelId);
    return await join(modelDir, fileName);
  }

  static async getModelDir(modelId: string, createIfNotExists: boolean = true): Promise<string> {
    const modelsDir = await join(await appDataDir(), 'models');
    if (createIfNotExists && !(await exists(modelsDir))) {
      await this.createDirRecursive(modelsDir);
    }

    const modelDir = await join(modelsDir, modelId);
    if (createIfNotExists && !(await exists(modelDir))) {
      await this.createDirRecursive(modelDir);
    }

    return modelDir;
  }

  /**
   * 递归创建目录
   * 根据 Tauri 官方文档, 应使用 `mkdir` 创建目录[[source](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/plugin/file-system.mdx#_snippet_28)]
   */
  private static async createDirRecursive(dir: string): Promise<void> {
    // 根路径或已存在则直接返回
    if (!dir || /^[a-zA-Z]:\\?$/.test(dir) || await exists(dir)) {
      return;
    }

    // 先递归创建父目录
    const parentDir = await dirname(dir);
    if (parentDir !== dir) {
      await this.createDirRecursive(parentDir);
    }

    // 再创建当前目录
    await mkdir(dir);
  }

  /**
   * 创建目录(实例方法封装)
   */
  private async createDir(dir: string): Promise<void> {
    await OnnxModelDownloader.createDirRecursive(dir);
  }

  private static async downloadFile(
    url: string,
    destinationPath: string,
    onProgress: (info: { progress: number; total: number }) => void
  ): Promise<void> {
    const lastSlashIndex = Math.max(destinationPath.lastIndexOf('/'), destinationPath.lastIndexOf('\\'));
    const dir = lastSlashIndex === -1 ? '' : destinationPath.substring(0, lastSlashIndex);
    if (!(await exists(dir))) {
      await this.createDirRecursive(dir);
    }
    
    console.log(`开始下载: ${url} -> ${destinationPath}`);
    await download(url, destinationPath, ({ progress, total }) => {
      onProgress({ progress, total });
    });
    console.log(`下载完成: ${destinationPath}`);
  }
} 