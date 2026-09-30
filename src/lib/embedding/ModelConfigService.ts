import { invoke } from '@tauri-apps/api/core';
import modelsConfig from '@/lib/models.json';

/**
 * 完整的模型配置接口
 */
export interface ModelConfig {
  id: string;
  name: string;
  description: string;
  size?: string;
  strategy: 'ollama' | 'local-onnx';
  
  // 核心配置
  dimensions?: number;
  contextLength?: number;
  
  // 下载相关（local-onnx）
  downloadUrl?: string;
  fileName?: string;
  tokenizerUrl?: string;
  tokenizerFileName?: string;
  
  // 分类与推荐
  isRecommended?: boolean;
  category?: string;
  
  // 自动检测的信息
  actualDimensions?: number;
  isLoaded?: boolean;
  lastDetected?: Date;
}

/**
 * 已知模型的维度映射（备用）
 * 注意：这些值基于实际测试和官方文档
 */
const KNOWN_DIMENSIONS: Record<string, number> = {
  // Ollama模型
  'nomic-embed-text': 768,
  'all-minilm': 384,                                    // all-MiniLM-L6-v2
  'mxbai-embed-large': 1024,
  'sentence-transformers/all-MiniLM-L6-v2': 384,
  'sentence-transformers/all-MiniLM-L12-v2': 384,
  
  // Local ONNX模型 - 基于官方文档
  'all-minilm-l6-v2': 384,                            // 官方确认为384维
  'bge-small-zh-v1.5': 512,
  'text-embedding-ada-002': 1536,
  
  // 常见的其他模型
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
};

/**
 * 模型配置服务
 * 统一管理所有嵌入模型的配置信息，支持自动检测维度
 */
export class ModelConfigService {
  private static instance: ModelConfigService;
  private modelConfigs: Map<string, ModelConfig> = new Map();
  private dimensionCache: Map<string, number> = new Map();

  private constructor() {
    this.loadModelConfigs();
  }

  static getInstance(): ModelConfigService {
    if (!ModelConfigService.instance) {
      ModelConfigService.instance = new ModelConfigService();
    }
    return ModelConfigService.instance;
  }

  /**
   * 加载模型配置
   */
  private loadModelConfigs(): void {
    for (const config of modelsConfig as any[]) {
      // 兼容不同数据源：将 strategy 规范化为受控联合类型
      const strategy: 'ollama' | 'local-onnx' = ((): any => {
        const s = String(config.strategy || '').toLowerCase();
        if (s === 'ollama') return 'ollama';
        if (s === 'local-onnx' || s === 'onnx' || s === 'local') return 'local-onnx';
        return 'ollama';
      })();

      const modelConfig: ModelConfig = {
        id: String(config.id),
        name: String(config.name || config.id),
        description: String(config.description || ''),
        size: config.size,
        strategy,
        // 优先使用配置文件中的dimensions，否则使用已知映射
        dimensions: config.dimensions || KNOWN_DIMENSIONS[config.id],
        contextLength: config.contextLength,
        downloadUrl: config.downloadUrl,
        fileName: config.fileName,
        tokenizerUrl: config.tokenizerUrl,
        tokenizerFileName: config.tokenizerFileName,
        isRecommended: !!config.isRecommended,
        category: config.category,
      };
      
      this.modelConfigs.set(config.id, modelConfig);
      
      // 缓存维度信息
      if (modelConfig.dimensions) {
        this.dimensionCache.set(config.id, modelConfig.dimensions);
      }
    }
    
    console.log('[ModelConfigService] 已加载', this.modelConfigs.size, '个模型配置');
  }

  /**
   * 获取模型配置
   */
  getModelConfig(modelId: string): ModelConfig | null {
    return this.modelConfigs.get(modelId) || null;
  }

  getModelContextLength(modelId: string): number | undefined {
    const value = this.getModelConfig(modelId)?.contextLength;
    return Number.isFinite(value) && (value as number) > 0 ? value : undefined;
  }

  /**
   * 获取所有模型配置
   */
  getAllModels(): ModelConfig[] {
    return Array.from(this.modelConfigs.values());
  }

  /**
   * 按策略获取模型
   */
  getModelsByStrategy(strategy: 'ollama' | 'local-onnx'): ModelConfig[] {
    return this.getAllModels().filter(model => model.strategy === strategy);
  }

  /**
   * 获取推荐模型
   */
  getRecommendedModels(): ModelConfig[] {
    return this.getAllModels().filter(model => model.isRecommended);
  }

  /**
   * 获取模型维度（核心方法）
   * 优先级：实际检测 > 缓存 > 配置文件 > 已知映射 > 默认值
   */
  async getModelDimensions(modelId: string): Promise<number> {
    console.log(`[ModelConfigService] 获取模型 ${modelId} 的维度`);

    // 1. 检查缓存
    const cached = this.dimensionCache.get(modelId);
    if (cached) {
      console.log(`[ModelConfigService] 从缓存获取维度: ${cached}`);
      return cached;
    }

    // 2. 尝试自动检测
    const detected = await this.detectModelDimensions(modelId);
    if (detected > 0) {
      console.log(`[ModelConfigService] 自动检测到维度: ${detected}`);
      this.dimensionCache.set(modelId, detected);
      this.updateModelActualDimensions(modelId, detected);
      return detected;
    }

    // 3. 从配置文件获取
    const config = this.getModelConfig(modelId);
    if (config?.dimensions) {
      console.log(`[ModelConfigService] 从配置文件获取维度: ${config.dimensions}`);
      this.dimensionCache.set(modelId, config.dimensions);
      return config.dimensions;
    }

    // 4. 从已知映射获取
    const known = KNOWN_DIMENSIONS[modelId];
    if (known) {
      console.log(`[ModelConfigService] 从已知映射获取维度: ${known}`);
      this.dimensionCache.set(modelId, known);
      return known;
    }

    // 5. 默认值
    const defaultDim = 384;
    console.warn(`[ModelConfigService] 未找到模型 ${modelId} 的维度信息，使用默认值: ${defaultDim}`);
    return defaultDim;
  }

  /**
   * 自动检测模型维度
   */
  private async detectModelDimensions(modelId: string): Promise<number> {
    const config = this.getModelConfig(modelId);
    if (!config) return 0;

    try {
      switch (config.strategy) {
        case 'local-onnx':
          return await this.detectOnnxModelDimensions(modelId);
        case 'ollama':
          return await this.detectOllamaModelDimensions(modelId);
        default:
          return 0;
      }
    } catch (error) {
      console.warn(`[ModelConfigService] 自动检测模型 ${modelId} 维度失败:`, error);
      return 0;
    }
  }

  /**
   * 检测ONNX模型维度
   */
  private async detectOnnxModelDimensions(modelId: string): Promise<number> {
    try {
      // 调用Rust后端获取模型信息
      const modelInfo = await invoke('get_onnx_model_info', { modelId });
      if (modelInfo && typeof modelInfo === 'object' && 'outputDimension' in modelInfo) {
        return (modelInfo as any).outputDimension;
      }
    } catch (error) {
      console.log(`[ModelConfigService] 无法从Rust后端获取ONNX模型信息:`, error);
    }
    
    return 0;
  }

  /**
   * 检测Ollama模型维度
   */
  private async detectOllamaModelDimensions(modelId: string): Promise<number> {
    try {
      // 可以通过调用Ollama API获取模型信息
      // 这里暂时返回0，表示无法自动检测
      return 0;
    } catch (error) {
      console.log(`[ModelConfigService] 无法检测Ollama模型维度:`, error);
      return 0;
    }
  }

  /**
   * 更新模型的实际维度信息
   */
  private updateModelActualDimensions(modelId: string, dimensions: number): void {
    const config = this.modelConfigs.get(modelId);
    if (config) {
      config.actualDimensions = dimensions;
      config.lastDetected = new Date();
      this.modelConfigs.set(modelId, config);
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.dimensionCache.clear();
    console.log('[ModelConfigService] 已清除维度缓存');
  }

  /**
   * 手动设置模型维度（用于测试或特殊情况）
   */
  setModelDimensions(modelId: string, dimensions: number): void {
    this.dimensionCache.set(modelId, dimensions);
    this.updateModelActualDimensions(modelId, dimensions);
    console.log(`[ModelConfigService] 手动设置模型 ${modelId} 维度为 ${dimensions}`);
  }

  /**
   * 获取模型统计信息
   */
  getStats(): {
    totalModels: number;
    byStrategy: Record<string, number>;
    withDimensions: number;
    cached: number;
  } {
    const models = this.getAllModels();
    const byStrategy: Record<string, number> = {};
    
    for (const model of models) {
      byStrategy[model.strategy] = (byStrategy[model.strategy] || 0) + 1;
    }
    
    return {
      totalModels: models.length,
      byStrategy,
      withDimensions: models.filter(m => m.dimensions || m.actualDimensions).length,
      cached: this.dimensionCache.size,
    };
  }
}

// 导出单例实例
export const modelConfigService = ModelConfigService.getInstance();
