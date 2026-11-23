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
import { useTranslation } from '@/i18n/useTranslation';
import { useLocaleStore } from '@/store/localeStore';

interface EmbeddingModelManagerProps {
  onModelChange?: (modelId: string | null) => void;
}

export function EmbeddingModelManager({ onModelChange }: EmbeddingModelManagerProps) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<'local-onnx' | 'ollama'>('local-onnx');
  const [downloadProgress, setDownloadProgress] = useState<Map<string, ModelDownloadProgress>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [ollamaUrl, setOllamaUrl] = useState<string>('localhost:11434'); // 默认显示值，将在初始化时更新
  const t = useTranslation();

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
        
        toast.success(t('settings.knowledge.embeddingManager.toast.downloadComplete').replace('{0}', modelName), {
          description: t('settings.knowledge.embeddingManager.toast.knowledgeSynced')
        });
      }
    } catch (error) {
      console.error('下载模型失败:', error);
      toast.error(t('settings.knowledge.embeddingManager.toast.downloadFailed'), {
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
          
          toast.success(t('settings.knowledge.embeddingManager.toast.deleted').replace('{0}', modelName), {
            description: t('settings.knowledge.embeddingManager.toast.knowledgeReset')
          });
        }
      }
    } catch (error) {
      console.error('删除模型失败:', error);
      toast.error(t('settings.knowledge.embeddingManager.toast.deleteFailed'), {
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
      toast.success(t('settings.knowledge.embeddingManager.toast.activated').replace('{0}', modelName), {
        description: t('settings.knowledge.embeddingManager.toast.activationDescription')
      });
    } catch (error) {
      console.error('激活模型失败:', error);
      toast.error(t('settings.knowledge.embeddingManager.toast.activateFailed'), {
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
        <div className="text-slate-500">{t('settings.knowledge.embeddingManager.loading')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 策略选择 */}
      <div className="space-y-3">
        <div className="flex items-center space-x-2">
          <Brain className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-medium">{t('settings.knowledge.embeddingManager.title')}</h3>
        </div>
        
        <div className="flex space-x-2">
          <Button
            variant={selectedStrategy === 'local-onnx' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedStrategy('local-onnx')}
          >
            {t('settings.knowledge.embeddingManager.localStrategy')}
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
            {t('settings.knowledge.embeddingManager.ollamaStrategy')}
          </Button>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-400">
          {selectedStrategy === 'local-onnx' 
            ? t('settings.knowledge.embeddingManager.localDescription')
            : t('settings.knowledge.embeddingManager.ollamaDescription').replace('{0}', ollamaUrl)
          }
        </p>
      </div>

      {/* 模型列表 */}
      <div className="space-y-3">
        {currentModels.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            {t('settings.knowledge.embeddingManager.empty')}
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
              {t('settings.knowledge.embeddingManager.ready')}
            </span>
          </div>
        </div>
      )}

      {currentModels.length > 0 && !currentModels.some(m => m.isActive) && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-yellow-600" />
            <span className="text-sm text-yellow-800 dark:text-yellow-300">
              {t('settings.knowledge.embeddingManager.activationPrompt')}
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
  const t = useTranslation();
  const locale = useLocaleStore((state) => state.locale);
  // The model catalogue ships a Chinese description; English users get the
  // English one when the catalogue has it.
  const description = locale === 'en' ? (model.descriptionEn ?? model.description) : model.description;
  const getStatusBadge = () => {
    if (model.isActive) {
      return <Badge variant="default" className="bg-green-600">{t('settings.knowledge.embeddingManager.status.active')}</Badge>;
    }
    if (model.isDownloading) {
      return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />{t('settings.knowledge.embeddingManager.status.downloading')}</Badge>;
    }
    if (model.isDownloaded) {
      return <Badge variant="outline" className="text-green-600 border-green-600">{t('settings.knowledge.embeddingManager.status.downloaded')}</Badge>;
    }
    return <Badge variant="outline">{t('settings.knowledge.embeddingManager.status.notDownloaded')}</Badge>;
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
          {t('common.cancel')}
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
              {t('settings.knowledge.embeddingManager.activate')}
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
        {t('settings.knowledge.embeddingManager.download')}
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
            {description}
          </p>
          <p className="text-xs text-slate-500">
            {t('settings.knowledge.embeddingManager.size').replace('{0}', model.size)}
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
            <span>{t('settings.knowledge.embeddingManager.downloadProgress')}</span>
            <span>{downloadProgress.progress}%</span>
          </div>
          <Progress value={downloadProgress.progress} className="h-2" />
          {downloadProgress.speed && (
            <div className="text-xs text-slate-500">
              {t('settings.knowledge.embeddingManager.speed').replace('{0}', downloadProgress.speed)}
              {downloadProgress.eta && ` • ${t('settings.knowledge.embeddingManager.eta').replace('{0}', downloadProgress.eta)}`}
            </div>
          )}
        </div>
      )}

      {/* 错误信息 */}
      {downloadProgress?.status === 'error' && downloadProgress.error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-2">
          <p className="text-sm text-red-800 dark:text-red-300">
            {t('settings.knowledge.embeddingManager.downloadFailed').replace('{0}', downloadProgress.error)}
          </p>
        </div>
      )}
    </div>
  );
} 