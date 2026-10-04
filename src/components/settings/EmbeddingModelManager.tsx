"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Brain, Download, Trash2, CheckCircle, Clock, AlertCircle, X } from 'lucide-react';
import { 
  ModelInfo, 
  ModelDownloadProgress, 
  getModelManager 
} from '@/lib/embedding/ModelManager';
import { OllamaConfigService } from '@/lib/config/OllamaConfigService';
import { toast } from '@/components/ui/sonner';

interface EmbeddingModelManagerProps {
  onModelChange?: (modelId: string | null) => void;
}

export function EmbeddingModelManager({ onModelChange }: EmbeddingModelManagerProps) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<'local-onnx' | 'ollama'>('local-onnx');
  const [downloadProgress, setDownloadProgress] = useState<Map<string, ModelDownloadProgress>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [ollamaUrl, setOllamaUrl] = useState<string>('localhost:11434'); // 默认显示值，将在初始化时更新

  const modelManager = getModelManager();

  // 加载模型状态
  useEffect(() => {
    const loadModels = async () => {
      try {
        await modelManager.checkModelStatus();
        setModels(modelManager.getAllModels());
        
        // 获取配置的 Ollama URL
        const url = await OllamaConfigService.getOllamaUrl();
        setOllamaUrl(url.replace('http://', '').replace('https://', ''));
        
        // 检查是否有激活的模型
        const activeModel = modelManager.getActiveModel();
        if (activeModel) {
          setSelectedStrategy(activeModel.strategy);
          onModelChange?.(activeModel.id);
        }
      } catch (error) {
        console.error('加载模型状态失败:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadModels();
  }, [onModelChange]);

  // 处理下载进度
  const handleDownloadProgress = (progress: ModelDownloadProgress) => {
    setDownloadProgress(prev => new Map(prev.set(progress.modelId, progress)));
    
    if (progress.status === 'completed') {
      // 刷新模型状态
      setModels(modelManager.getAllModels());
    }
  };

  // 下载模型
  const handleDownloadModel = async (modelId: string) => {
    try {
      await modelManager.downloadModel(modelId, handleDownloadProgress);
      setModels(modelManager.getAllModels());
      
      // 如果这是第一个下载的模型，自动激活并同步配置
      const activeModel = modelManager.getActiveModel();
      if (activeModel && activeModel.id === modelId) {
        // 同步知识库配置
        await synchronizeKnowledgeBaseConfig(modelId);
        onModelChange?.(modelId);
        
        // 获取模型名称用于提示
        const model = models.find(m => m.id === modelId);
        const modelName = model?.name || modelId;
        
        toast.success(`${modelName} 下载完成并已激活`, {
          description: '知识库配置已自动同步'
        });
      }
    } catch (error) {
      console.error('下载模型失败:', error);
      toast.error('下载模型失败', {
        description: error instanceof Error ? error.message : String(error)
      });
    }
  };

  // 取消下载
  const handleCancelDownload = (modelId: string) => {
    modelManager.cancelDownload(modelId);
    setDownloadProgress(prev => {
      const newMap = new Map(prev);
      newMap.delete(modelId);
      return newMap;
    });
    setModels(modelManager.getAllModels());
  };

  // 删除模型
  const handleDeleteModel = async (modelId: string) => {
    try {
      // 检查是否删除的是当前激活的模型
      const activeModel = modelManager.getActiveModel();
      const wasActive = activeModel?.id === modelId;
      
      await modelManager.deleteModel(modelId);
      setModels(modelManager.getAllModels());
      
      // 如果删除的是激活模型，清除选择并重置配置
      const newActiveModel = modelManager.getActiveModel();
      if (!newActiveModel) {
        onModelChange?.(null);
        
        // 如果删除的是激活模型，重置知识库配置为默认值
        if (wasActive) {
          await resetKnowledgeBaseConfigToDefault();
          
          // 获取模型名称用于提示
          const model = models.find(m => m.id === modelId);
          const modelName = model?.name || modelId;
          
          toast.success(`${modelName} 已删除`, {
            description: '知识库配置已重置为默认值'
          });
        }
      }
    } catch (error) {
      console.error('删除模型失败:', error);
      toast.error('删除模型失败', {
        description: error instanceof Error ? error.message : String(error)
      });
    }
  };

  // 重置知识库配置为默认值
  const resetKnowledgeBaseConfigToDefault = async () => {
    try {
      console.log('[EmbeddingModelManager] 重置知识库配置为默认值');
      
      const { getKnowledgeBaseConfigManager, DEFAULT_KNOWLEDGE_BASE_CONFIG } = await import('@/lib/knowledgeBaseConfig');
      const configManager = getKnowledgeBaseConfigManager();
      
      // 强制保存默认配置
      await configManager.saveConfig(DEFAULT_KNOWLEDGE_BASE_CONFIG);
      
      console.log('[EmbeddingModelManager] 知识库配置已重置为默认值');
    } catch (error) {
      console.error('[EmbeddingModelManager] 重置知识库配置失败:', error);
      throw error;
    }
  };

  // 激活模型
  const handleActivateModel = async (modelId: string) => {
    try {
      console.log('[EmbeddingModelManager] 开始激活模型:', modelId);
      
      // 1. 激活模型
      await modelManager.setActiveModel(modelId);
      setModels(modelManager.getAllModels());
      
      // 2. 同步更新知识库配置 - 强制覆盖用户保存的配置
      await synchronizeKnowledgeBaseConfig(modelId);
      
      onModelChange?.(modelId);
      
      // 获取模型名称用于提示
      const model = models.find(m => m.id === modelId);
      const modelName = model?.name || modelId;
      
      console.log('[EmbeddingModelManager] 模型激活完成，配置已同步');
      toast.success(`${modelName} 已激活`, {
        description: '知识库配置已自动同步，可以开始使用RAG功能'
      });
    } catch (error) {
      console.error('激活模型失败:', error);
      toast.error('激活模型失败', {
        description: error instanceof Error ? error.message : String(error)
      });
    }
  };

  // 同步知识库配置函数
  const synchronizeKnowledgeBaseConfig = async (modelId: string) => {
    try {
      console.log('[EmbeddingModelManager] 开始同步知识库配置，模型ID:', modelId);
      
      // 获取模型信息
      const model = models.find(m => m.id === modelId);
      if (!model) {
        console.error('[EmbeddingModelManager] 未找到模型信息:', modelId);
        return;
      }

      // 导入配置管理器
      const { getKnowledgeBaseConfigManager } = await import('@/lib/knowledgeBaseConfig');
      const { modelConfigService } = await import('@/lib/embedding/ModelConfigService');
      
      const configManager = getKnowledgeBaseConfigManager();
      const currentConfig = configManager.getConfig();
      
      // 获取模型的正确维度信息
      const dimensions = await modelConfigService.getModelDimensions(modelId);
      
      // 创建新的配置
      const newConfig = {
        ...currentConfig,
        embedding: {
          ...currentConfig.embedding,
          strategy: selectedStrategy,
          modelPath: selectedStrategy === 'local-onnx' ? `models/${modelId}` : '',
          modelName: modelId,
          dimensions: dimensions,
          // 如果是ollama策略，设置API URL
          apiUrl: selectedStrategy === 'ollama' ? `http://${ollamaUrl}` : ''
        }
      };
      
      console.log('[EmbeddingModelManager] 更新前配置:', {
        strategy: currentConfig.embedding.strategy,
        modelPath: currentConfig.embedding.modelPath,
        modelName: currentConfig.embedding.modelName,
        dimensions: currentConfig.embedding.dimensions
      });
      
      console.log('[EmbeddingModelManager] 更新后配置:', {
        strategy: newConfig.embedding.strategy,
        modelPath: newConfig.embedding.modelPath,
        modelName: newConfig.embedding.modelName,
        dimensions: newConfig.embedding.dimensions
      });
      
      // 强制保存新配置 - 这会覆盖用户之前保存的任何配置
      await configManager.saveConfig(newConfig);
      
      console.log('[EmbeddingModelManager] 知识库配置已强制更新');
      
    } catch (error) {
      console.error('[EmbeddingModelManager] 同步知识库配置失败:', error);
      throw error;
    }
  };

  // 刷新配置（当用户修改 Ollama 配置时调用）
  const refreshConfiguration = async () => {
    try {
      // 更新 ModelManager 的 Ollama URL
      await modelManager.updateOllamaUrl();
      
      // 更新本地显示的 URL
      const url = await OllamaConfigService.getOllamaUrl();
      setOllamaUrl(url.replace('http://', '').replace('https://', ''));
      
      // 重新检查模型状态
      await modelManager.checkModelStatus();
      setModels(modelManager.getAllModels());
    } catch (error) {
      console.error('刷新配置失败:', error);
    }
  };

  // 获取当前策略的模型
  const currentModels = models.filter(model => model.strategy === selectedStrategy);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="text-slate-500">加载模型状态中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 策略选择 */}
      <div className="space-y-3">
        <div className="flex items-center space-x-2">
          <Brain className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-medium">嵌入模型管理</h3>
        </div>
        
        <div className="flex space-x-2">
          <Button
            variant={selectedStrategy === 'local-onnx' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedStrategy('local-onnx')}
          >
            本地模型
          </Button>
          <Button
            variant={selectedStrategy === 'ollama' ? 'default' : 'outline'}
            size="sm"
            onClick={async () => {
              setSelectedStrategy('ollama');
              if (selectedStrategy !== 'ollama') {
                await refreshConfiguration();
              }
            }}
          >
            Ollama 服务
          </Button>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-400">
          {selectedStrategy === 'local-onnx' 
            ? '本地离线推理模型，完全离线运行，无需外部服务'
            : `Ollama模型需要本地运行Ollama服务 (${ollamaUrl})`
          }
        </p>
      </div>

      {/* 模型列表 */}
      <div className="space-y-3">
        {currentModels.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            该策略下暂无可用模型
          </div>
        ) : (
          currentModels.map(model => (
            <ModelCard
              key={model.id}
              model={model}
              downloadProgress={downloadProgress.get(model.id)}
              onDownload={() => handleDownloadModel(model.id)}
              onCancel={() => handleCancelDownload(model.id)}
              onDelete={() => handleDeleteModel(model.id)}
              onActivate={() => handleActivateModel(model.id)}
            />
          ))
        )}
      </div>

      {/* 状态提示 */}
      {currentModels.some(m => m.isActive) && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
          <div className="flex items-center space-x-2">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span className="text-sm text-green-800 dark:text-green-300">
              嵌入服务已就绪，可以开始使用知识库功能
            </span>
          </div>
        </div>
      )}

      {currentModels.length > 0 && !currentModels.some(m => m.isActive) && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-yellow-600" />
            <span className="text-sm text-yellow-800 dark:text-yellow-300">
              请下载并激活一个模型以启用嵌入功能
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

interface ModelCardProps {
  model: ModelInfo;
  downloadProgress?: ModelDownloadProgress;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onActivate: () => void;
}

function ModelCard({ 
  model, 
  downloadProgress, 
  onDownload, 
  onCancel, 
  onDelete, 
  onActivate 
}: ModelCardProps) {
  const getStatusBadge = () => {
    if (model.isActive) {
      return <Badge variant="default" className="bg-green-600">激活中</Badge>;
    }
    if (model.isDownloading) {
      return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />下载中</Badge>;
    }
    if (model.isDownloaded) {
      return <Badge variant="outline" className="text-green-600 border-green-600">已下载</Badge>;
    }
    return <Badge variant="outline">未下载</Badge>;
  };

  const getActionButton = () => {
    if (model.isDownloading) {
      return (
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          className="text-red-600 hover:text-red-700"
        >
          <X className="w-4 h-4 mr-1" />
          取消
        </Button>
      );
    }

    if (model.isDownloaded) {
      return (
        <div className="flex space-x-2">
          {!model.isActive && (
            <Button
              variant="default"
              size="sm"
              onClick={onActivate}
            >
              激活
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onDelete}
            className="text-red-600 hover:text-red-700"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      );
    }

    return (
      <Button
        variant="outline"
        size="sm"
        onClick={onDownload}
        className="text-blue-600 hover:text-blue-700"
      >
        <Download className="w-4 h-4 mr-1" />
        下载
      </Button>
    );
  };

  return (
    <div className="embed-card">
      {/* 模型信息 */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <h4 className="font-medium">{model.name}</h4>
            {getStatusBadge()}
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {model.description}
          </p>
          <p className="text-xs text-slate-500">
            大小: {model.size}
          </p>
        </div>
        
        <div className="flex-shrink-0">
          {getActionButton()}
        </div>
      </div>

      {/* 下载进度 */}
      {model.isDownloading && downloadProgress && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>下载进度</span>
            <span>{downloadProgress.progress}%</span>
          </div>
          <Progress value={downloadProgress.progress} className="h-2" />
          {downloadProgress.speed && (
            <div className="text-xs text-slate-500">
              速度: {downloadProgress.speed}
              {downloadProgress.eta && ` • 剩余: ${downloadProgress.eta}`}
            </div>
          )}
        </div>
      )}

      {/* 错误信息 */}
      {downloadProgress?.status === 'error' && downloadProgress.error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-2">
          <p className="text-sm text-red-800 dark:text-red-300">
            下载失败: {downloadProgress.error}
          </p>
        </div>
      )}
    </div>
  );
} 