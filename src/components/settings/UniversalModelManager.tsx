"use client";

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Download, 
  Trash2, 
  CheckCircle, 
  Clock, 
  AlertCircle,
  Server,
  HardDrive,
  Globe,
  RefreshCw,
  Zap
} from 'lucide-react';
import type { EmbeddingConfig } from '@/lib/embedding/types';
import { OnnxModelDownloader, type OnnxModelInfo, type ModelDownloadProgress } from '@/lib/embedding/OnnxModelDownloader';
import { getKnowledgeBaseConfigManager } from '@/lib/knowledgeBaseConfig';
import { toast } from '@/components/ui/sonner';
import modelsConfig from '@/lib/models.json';

interface ModelInfo {
  id: string;
  name: string;
  description: string;
  size?: string;
  strategy: 'ollama' | 'local-onnx';
  status: 'available' | 'downloading' | 'installed' | 'error';
  downloadProgress?: number;
  downloadHint?: string;
  selected?: boolean;
  isRecommended?: boolean;
  category?: string;
  downloadUrl?: string;
  fileName?: string;
  tokenizerUrl?: string;
  tokenizerFileName?: string;
  dimensions?: number;
}

interface UniversalModelManagerProps {
}

export function UniversalModelManager({}: UniversalModelManagerProps) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<'ollama' | 'local-onnx'>('local-onnx');
  const [currentEmbedding, setCurrentEmbedding] = useState<EmbeddingConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [isTestingOllama, setIsTestingOllama] = useState(false);
  const [isTestingService, setIsTestingService] = useState(false);
  const [testResult, setTestResult] = useState<{success: boolean; latency?: number; dimension?: number} | null>(null);
  const onnxDownloader = useRef(new OnnxModelDownloader());
  const simTimers = useRef<Record<string, NodeJS.Timeout>>({});

  const getAllModelDefinitions = (): ModelInfo[] => {
    return modelsConfig.map(config => ({
      id: config.id,
      name: config.name,
      description: config.description,
      size: config.size,
      strategy: config.strategy as 'ollama' | 'local-onnx',
      status: 'available' as const,
      isRecommended: config.isRecommended,
      category: config.category,
      downloadUrl: config.downloadUrl,
      fileName: config.fileName,
      tokenizerUrl: (config as any).tokenizerUrl,
      tokenizerFileName: (config as any).tokenizerFileName,
      dimensions: (config as any).dimensions,
    }));
  };

  // 获取策略的友好显示名称
  const getStrategyDisplayName = (strategy: 'ollama' | 'local-onnx'): string => {
    switch (strategy) {
      case 'ollama':
        return 'Ollama 服务';
      case 'local-onnx':
        return '本地模型';
      default:
        return strategy;
    }
  };

  // 获取策略的描述信息
  const getStrategyDescription = (strategy: 'ollama' | 'local-onnx'): string => {
    switch (strategy) {
      case 'ollama':
        return 'Ollama 提供的在线推理服务，需要 Ollama 服务运行';
      case 'local-onnx':
        return '本地离线推理模型，支持完全离线使用，无需外部服务';
      default:
        return '未知策略';
    }
  };

  // 格式化文件大小显示
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // 从配置管理器加载当前配置
  const loadCurrentConfig = async () => {
    try {
      const configManager = getKnowledgeBaseConfigManager();
      await configManager.ensureLoaded();
      const knowledgeConfig = configManager.getConfig();
      
      console.log('加载知识库配置:', knowledgeConfig.embedding);
      
      // 处理策略兼容性：将旧的tauri-ort转换为local-onnx
      let strategy = knowledgeConfig.embedding.strategy;
      if ((strategy as any) === 'tauri-ort') {
        strategy = 'local-onnx';
        // 更新配置以保存正确的策略
        await configManager.updateConfig('embedding', {
          ...knowledgeConfig.embedding,
          strategy: 'local-onnx'
        });
      }
      
      const embeddingConfig: EmbeddingConfig = {
        strategy: strategy,
        modelPath: knowledgeConfig.embedding.modelPath,
        modelName: knowledgeConfig.embedding.modelName,
        tokenizerPath: knowledgeConfig.embedding.tokenizerPath,
        apiUrl: knowledgeConfig.embedding.apiUrl,
        timeout: knowledgeConfig.embedding.timeout,
        maxBatchSize: knowledgeConfig.embedding.maxBatchSize,
      };
      
      console.log('转换后的嵌入配置:', embeddingConfig);
      
      // 确保立即更新所有相关状态
      setCurrentEmbedding(embeddingConfig);
      setSelectedStrategy(embeddingConfig.strategy);
      
      // 强制更新模型列表和选中状态
      await updateModelListWithConfig(embeddingConfig);
      
    } catch (error) {
      console.error('加载当前配置失败:', error);
      // 设置默认配置以避免组件异常
      const defaultConfig: EmbeddingConfig = {
        strategy: 'local-onnx',
        modelPath: 'models/all-MiniLM-L6-v2',
        modelName: 'all-minilm-l6-v2',
        timeout: 10000,
        maxBatchSize: 128
      };
      setCurrentEmbedding(defaultConfig);
      setSelectedStrategy('local-onnx');
      await updateModelListWithConfig(defaultConfig);
    }
  };

  // 根据策略切换更新模型列表（独立于当前配置）
  const updateModelListByStrategy = async (strategy: 'ollama' | 'local-onnx') => {
    console.log('根据策略更新模型列表:', strategy);
    
    const baseList = getAllModelDefinitions().filter(m => m.strategy === strategy);
    
    // 当前选中状态基于配置，但列表基于用户选择的策略
    const listWithSelection = baseList.map(m => {
      let isSelected = false;
      
      // 只有当策略与当前配置一致时，才应用选中状态
      if (currentEmbedding && currentEmbedding.strategy === strategy) {
        if (strategy === 'ollama') {
          // Ollama模型通过modelName匹配
          isSelected = currentEmbedding.modelName === m.id;
        } else {
          // ONNX模型优先通过modelName匹配，其次通过modelPath匹配
          if (currentEmbedding.modelName) {
            isSelected = currentEmbedding.modelName === m.id;
          } else if (currentEmbedding.modelPath) {
            // 兼容旧配置：检查modelPath是否包含模型ID
            isSelected = currentEmbedding.modelPath.includes(m.id);
          }
        }
      }
      
      return { ...m, selected: isSelected };
    });

    console.log('更新模型选中状态:', { 
      strategy, 
      currentStrategy: currentEmbedding?.strategy,
      selectedModels: listWithSelection.filter(m => m.selected).map(m => m.id)
    });

    setModels(listWithSelection);
    
    // 检查模型状态
    await checkModelStatus();
  };

  // 根据配置更新模型列表和选中状态（保持原有逻辑以兼容配置变更）
  const updateModelListWithConfig = async (embeddingConfig: EmbeddingConfig) => {
    console.log('根据配置更新模型列表:', embeddingConfig);
    
    const strategy = embeddingConfig.strategy;
    
    // 确保selectedStrategy与配置一致
    if (selectedStrategy !== strategy) {
      setSelectedStrategy(strategy);
    }
    
    await updateModelListByStrategy(strategy);
  };

  // 启动模拟进度工具
  const startFakeProgress = (
    modelId: string,
    start: number,
    end: number,
    step: number,
    interval: number,
    hint: string,
    next?: () => void
  ) => {
    if (simTimers.current[modelId]) clearInterval(simTimers.current[modelId]);
    simTimers.current[modelId] = setInterval(() => {
      let reached = false;
      setModels(prev => prev.map(m => {
        if (m.id !== modelId || m.downloadProgress === undefined) return m;
        const nextVal = Math.min(end, (m.downloadProgress || start) + step);
        if (nextVal >= end) reached = true;
        return { ...m, downloadProgress: nextVal, downloadHint: hint };
      }));
      if (reached) {
        clearInterval(simTimers.current[modelId]);
        if (next) next();
      }
    }, interval);
  };

  // 检查模型状态
  const checkModelStatus = async () => {
    setIsLoading(true);
    
    try {
      // 检查 Ollama 模型状态
      if (selectedStrategy === 'ollama') {
        await checkOllamaModels();
      } else {
        await onnxDownloader.current.waitUntilReady();
        await checkOnnxModels();
      }
    } catch (error) {
      console.error('检查模型状态失败:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // 检查 Ollama 模型
  const checkOllamaModels = async () => {
    try {
      setIsTestingOllama(true);
      // 获取配置的 Ollama URL
      const { OllamaConfigService } = await import('@/lib/config/OllamaConfigService');
      const url = await OllamaConfigService.getOllamaUrl();
      
      // 统一网络请求工具
      const { tauriFetch } = await import('@/lib/request');
      const response = await tauriFetch(`${url}/api/tags`, {
        method: 'GET',
        rawResponse: true,
        browserHeaders: true,
        danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
        fallbackToBrowserOnError: true,
        verboseDebug: true,
        debugTag: 'ModelList',
      });

      console.log('[checkOllamaModels] HTTP status', response.status, response.statusText);
      try {
        const preview = await response.clone().text();
        console.log('[checkOllamaModels] Raw body preview (first 500 chars):', preview.slice(0,500));
      } catch(e){ console.warn('无法读取响应文本', e); }
      
      if (response.ok) {
        const data = await response.json() as { models?: any[] };
        const modelNames = data.models?.map(m => m.name) || [];
        setOllamaModels(modelNames);

        console.log('[checkOllamaModels] 从Ollama获取到的模型:', modelNames);

        // 更新模型列表并保留选中状态
        // 支持模糊匹配，因为Ollama可能返回 "model:latest" 格式
        setModels(prev => prev.map(m => {
          if (m.strategy !== 'ollama') return m;
          
          // 检查是否已安装：支持精确匹配和模糊匹配
          const isInstalled = modelNames.some(installedName => {
            // 精确匹配
            if (installedName === m.id) return true;
            // 去掉版本标签的匹配 (例如 "nomic-embed-text:latest" 匹配 "nomic-embed-text")
            const baseName = installedName.split(':')[0];
            return baseName === m.id;
          });

          console.log(`[checkOllamaModels] 模型 ${m.id} 安装状态: ${isInstalled ? 'installed' : 'available'}`);
          
          return { 
            ...m, 
            status: isInstalled ? 'installed' as const : 'available' as const, 
            selected: m.selected 
          };
        }));

        setOllamaStatus('connected');
        toast.success(`Ollama连接成功 发现 ${modelNames.length} 个模型`);
      } else {
        setOllamaStatus('error');
        const msg = response.status ? `状态码 ${response.status}` : '无法访问 /api/tags';
        toast.error(`无法连接 Ollama`, { description: msg });
      }
    } catch (error: any) {
      setOllamaStatus('error');
      toast.error('无法连接 Ollama', { description: error?.message || '网络错误' });
    } finally {
      setIsTestingOllama(false);
    }
  };

  // 检查 ONNX 模型
  const checkOnnxModels = async () => {
    try {
      // 保持当前列表不变，只更新状态
      setModels(prev => prev.map(model => {
        if (model.strategy !== 'local-onnx') return model;
        return {
          ...model,
          status: onnxDownloader.current.isModelDownloaded(model.id) ? 'installed' as const : 'available' as const,
        };
      }));
    } catch (error) {
      console.error('检查 ONNX 模型失败:', error);
      setModels(prev => prev.map(model => {
        if (model.strategy !== 'local-onnx') return model;
        return { ...model, status: 'error' as const };
      }));
    }
  };

  // 下载/安装模型
  const handleInstallModel = async (model: ModelInfo) => {
    if (model.strategy === 'ollama') {
      await installOllamaModel(model);
    } else {
      await installOnnxModel(model);
    }
  };

  // 安装 Ollama 模型 - 使用真实的流式进度
  const installOllamaModel = async (model: ModelInfo) => {
    try {
      // 清除可能存在的模拟进度定时器
      if (simTimers.current[model.id]) {
        clearInterval(simTimers.current[model.id]);
        delete simTimers.current[model.id];
      }

      // 更新状态为下载中
      setModels(prev => prev.map(m => 
        m.id === model.id 
          ? { ...m, status: 'downloading', downloadProgress: 0, downloadHint: '连接服务器...' }
          : m
      ));

      // 动态获取配置的 Ollama URL
      const { OllamaConfigService } = await import('@/lib/config/OllamaConfigService');
      const ollamaUrl = await OllamaConfigService.getOllamaUrl();
      
      console.log(`[UniversalModelManager] 安装 Ollama 模型，使用 URL: ${ollamaUrl}`);

      // 使用流式请求获取真实下载进度
      const response = await fetch(`${ollamaUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          model: model.id,
          stream: true  // 启用流式响应
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP错误: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('响应体为空');
      }

             // 处理流式响应
       const reader = response.body.getReader();
       const decoder = new TextDecoder();
       let buffer = '';
       let isCompleted = false;

       try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            console.log('流式响应结束');
            break;
          }

          // 将字节转换为文本并添加到缓冲区
          buffer += decoder.decode(value, { stream: true });
          
          // 按行处理JSON对象
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // 保留可能不完整的最后一行

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            try {
              const progressData = JSON.parse(trimmedLine);
              console.log('下载进度数据:', progressData);

              // 根据不同状态更新进度
              if (progressData.status === 'pulling manifest') {
                setModels(prev => prev.map(m => 
                  m.id === model.id 
                    ? { ...m, downloadProgress: 5, downloadHint: '获取模型信息...' }
                    : m
                ));
                             } else if (progressData.status?.includes('downloading') || (progressData.total && progressData.completed)) {
                                 // 计算下载进度百分比
                 if (progressData.total && progressData.completed) {
                   const progress = Math.round((progressData.completed / progressData.total) * 85) + 10; // 10-95%
                   const sizeCompleted = formatFileSize(progressData.completed);
                   const sizeTotal = formatFileSize(progressData.total);
                   
                   setModels(prev => prev.map(m => 
                     m.id === model.id 
                       ? { 
                           ...m, 
                           downloadProgress: Math.min(progress, 95), 
                           downloadHint: `下载中: ${sizeCompleted} / ${sizeTotal}`
                         }
                       : m
                   ));
                 }
              } else if (progressData.status === 'verifying sha256 digest') {
                setModels(prev => prev.map(m => 
                  m.id === model.id 
                    ? { ...m, downloadProgress: 96, downloadHint: '验证文件完整性...' }
                    : m
                ));
              } else if (progressData.status === 'writing manifest') {
                setModels(prev => prev.map(m => 
                  m.id === model.id 
                    ? { ...m, downloadProgress: 98, downloadHint: '写入模型信息...' }
                    : m
                ));
              } else if (progressData.status === 'removing any unused layers') {
                setModels(prev => prev.map(m => 
                  m.id === model.id 
                    ? { ...m, downloadProgress: 99, downloadHint: '清理缓存...' }
                    : m
                ));
                             } else if (progressData.status === 'success') {
                 isCompleted = true;
                 setModels(prev => prev.map(m => 
                   m.id === model.id 
                     ? { 
                         ...m, 
                         status: 'installed', 
                         downloadProgress: undefined, 
                         downloadHint: undefined 
                       }
                     : m
                 ));
                 toast.success(`模型 ${model.name} 安装成功！`);
                 
                 // 刷新 Ollama 模型列表
                 await checkOllamaModels();
                 return; // 成功完成，退出函数
               }
            } catch (parseError) {
              console.warn('解析进度数据失败:', parseError, '原始数据:', trimmedLine);
            }
          }
        }
             } finally {
         reader.releaseLock();
       }

       // 如果流结束但没有收到成功状态，可能出现了问题
       if (!isCompleted) {
         console.warn('下载流意外结束，可能需要重试');
         setModels(prev => prev.map(m => 
           m.id === model.id 
             ? { 
                 ...m, 
                 status: 'error', 
                 downloadProgress: undefined, 
                 downloadHint: undefined 
               }
             : m
         ));
         toast.warning('下载可能未完成，请检查模型状态或重试');
       }

    } catch (error: any) {
      console.error('安装 Ollama 模型失败:', error);
      
      // 清除可能的定时器
      if (simTimers.current[model.id]) {
        clearInterval(simTimers.current[model.id]);
        delete simTimers.current[model.id];
      }

      setModels(prev => prev.map(m => 
        m.id === model.id 
          ? { 
              ...m, 
              status: 'error', 
              downloadProgress: undefined, 
              downloadHint: undefined 
            }
          : m
      ));
      
      toast.error(`模型安装失败: ${error.message}`);
    }
  };

  // 安装 ONNX 模型
  const installOnnxModel = async (model: ModelInfo) => {
    try {
      console.log('开始下载 ONNX 模型:', model.name);
      
      // 更新状态为下载中
      setModels(prev => prev.map(m => 
        m.id === model.id 
          ? { ...m, status: 'downloading', downloadProgress: 0, downloadHint: '准备下载模型...' }
          : m
      ));

      // 立即启动模型阶段模拟 0->79
      startFakeProgress(model.id, 0, 79, 1, 400, '下载模型中...', () => {
        // 第二阶段分词器 79->99
        startFakeProgress(model.id, 79, 99, 1, 600, '下载分词器中...');
      });

      // 使用真实的下载器下载模型
      await onnxDownloader.current.downloadModel(model.id, (progress: ModelDownloadProgress) => {
        if (progress.percentage >= 100) {
          if (simTimers.current[model.id]) clearInterval(simTimers.current[model.id]);
          setModels(prev => prev.map(m => m.id === model.id ? { ...m, downloadProgress: 100, downloadHint: '下载完成' } : m));
        }
      });

      // 下载完成，更新状态
      if (simTimers.current[model.id]) clearInterval(simTimers.current[model.id]);

      setModels(prev => prev.map(m => 
        m.id === model.id 
          ? { ...m, status: 'installed', downloadProgress: undefined, downloadHint: '下载完成' }
          : m
      ));

      console.log('ONNX 模型下载完成:', model.name);
      
    } catch (error) {
      console.error('ONNX 模型下载失败:', error);
      setModels(prev => prev.map(m => 
        m.id === model.id 
          ? { ...m, status: 'error', downloadProgress: undefined }
          : m
      ));
    }
  };

  // 删除模型
  const handleDeleteModel = async (model: ModelInfo) => {
    try {
      if (model.strategy === 'ollama') {
        // 使用统一的配置管理器获取 Ollama URL
        const { OllamaConfigService } = await import('@/lib/config/OllamaConfigService');
        const ollamaUrl = await OllamaConfigService.getOllamaUrl();

      const response = await fetch(`${ollamaUrl}/api/delete`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: model.id })
        });
        
        if (response.ok) {
          setModels(prev => prev.map(m => 
            m.id === model.id ? { ...m, status: 'available' } : m
          ));
        }
      } else {
        // 删除 ONNX 模型文件
        console.log('删除 ONNX 模型:', model.name);
        await onnxDownloader.current.deleteModel(model.id);
        setModels(prev => prev.map(m => 
          m.id === model.id ? { ...m, status: 'available' } : m
        ));
      }
    } catch (error) {
      console.error('删除模型失败:', error);
    }
  };

  // 选择模型
  const handleSelectModel = async (model: ModelInfo) => {
    if (model.status !== 'installed') return;

    let config: EmbeddingConfig;

    if (model.strategy === 'ollama') {
      // 使用统一的配置管理器获取 Ollama URL
      const { OllamaConfigService } = await import('@/lib/config/OllamaConfigService');
      const apiUrl = await OllamaConfigService.getOllamaUrl();

      config = {
        strategy: model.strategy,
        apiUrl,
        modelName: model.id,
        timeout: 30000,
        maxBatchSize: 10
      };
    } else {
      const paths = await onnxDownloader.current.getModelPaths(model.id);
      if (!paths) {
        toast.error('未找到模型文件，请先安装');
        return;
      }
      config = {
        strategy: model.strategy,
        modelPath: paths.model,
        modelName: model.id, // 添加模型名称以便匹配
        tokenizerPath: paths.tokenizer,
        timeout: 10000,
        maxBatchSize: 128
      };
    }

    // 直接保存到配置管理器
    try {
      const configManager = getKnowledgeBaseConfigManager();
      await configManager.updateConfig('embedding', config);
      
      // 立即更新本地状态
      setCurrentEmbedding(config);
      
      // 立即更新模型列表和选中状态
      await updateModelListWithConfig(config);
      
      console.log('模型选择已保存:', { modelId: model.id, config });
      toast.success(`已选择模型: ${model.name}`);
    } catch (error) {
      console.error('保存配置失败:', error);
      toast.error('保存配置失败');
    }
  };

  // 初始化时加载当前配置
  useEffect(() => {
    loadCurrentConfig();
  }, []);

  // 监听配置管理器的变化 - 关键功能！
  useEffect(() => {
    const configManager = getKnowledgeBaseConfigManager();
    
    const handleConfigChange = async (config: any) => {
      console.log('检测到配置变化，重新加载配置:', config.embedding);
      
      // 配置变化时重新加载和更新状态
      const embeddingConfig: EmbeddingConfig = {
        strategy: config.embedding.strategy,
        modelPath: config.embedding.modelPath,
        modelName: config.embedding.modelName,
        tokenizerPath: config.embedding.tokenizerPath,
        apiUrl: config.embedding.apiUrl,
        timeout: config.embedding.timeout,
        maxBatchSize: config.embedding.maxBatchSize,
      };
      
      setCurrentEmbedding(embeddingConfig);
      setSelectedStrategy(embeddingConfig.strategy);
      await updateModelListWithConfig(embeddingConfig);
    };
    
    configManager.addListener(handleConfigChange);
    
    return () => {
      configManager.removeListener(handleConfigChange);
    };
  }, []);

  // 当策略或当前嵌入配置变化时初始化模型列表并标记已选
  useEffect(() => {
    const baseList = getAllModelDefinitions().filter(m => m.strategy === selectedStrategy);
    const listWithSelection = baseList.map(m => {
      if (!currentEmbedding) return { ...m, selected: false };
      
      let isSelected = false;
      if (currentEmbedding.strategy === 'ollama') {
        // Ollama模型通过modelName匹配
        isSelected = currentEmbedding.modelName === m.id;
      } else {
        // ONNX模型优先通过modelName匹配，其次通过modelPath匹配
        if (currentEmbedding.modelName) {
          isSelected = currentEmbedding.modelName === m.id;
        } else if (currentEmbedding.modelPath) {
          // 兼容旧配置：检查modelPath是否包含模型ID
          isSelected = currentEmbedding.modelPath.includes(m.id);
        }
      }
      
      return { ...m, selected: isSelected };
    });

    console.log('更新模型选中状态:', { 
      strategy: selectedStrategy, 
      currentEmbedding, 
      selectedModels: listWithSelection.filter(m => m.selected).map(m => m.id)
    });

    setModels(listWithSelection);
    checkModelStatus();
  }, [selectedStrategy, currentEmbedding]);

  // 在组件卸载时清理所有定时器
  useEffect(() => {
    return () => {
      Object.values(simTimers.current).forEach(clearInterval);
    };
  }, []);

  const getStatusIcon = (model: ModelInfo) => {
    switch (model.status) {
      case 'installed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'downloading':
        return <Clock className="w-4 h-4 text-slate-500 animate-spin" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (model: ModelInfo) => {
    switch (model.status) {
      case 'installed':
        return <Badge variant="default" className="bg-green-500">已安装</Badge>;
      case 'downloading':
        return <Badge variant="secondary">下载中</Badge>;
      case 'error':
        return <Badge variant="destructive">错误</Badge>;
      default:
        return <Badge variant="outline">可用</Badge>;
    }
  };

  // 测试嵌入服务功能
  const testEmbeddingService = async () => {
    // 获取当前选中的模型
    const selectedModel = models.find(m => m.selected);
    if (!selectedModel) {
      toast.error('请先选择一个模型');
      return;
    }

    setIsTestingService(true);
    setTestResult(null);
    
    try {
      const { EmbeddingService } = await import('@/lib/embedding/EmbeddingService');
      
      // 根据当前界面选中的策略和模型动态构建配置
      const testConfig = {
        strategy: selectedModel.strategy,
        modelName: selectedModel.id,
        // 如果是本地ONNX模型，设置modelPath为模型ID（EmbeddingService会自动处理路径）
        ...(selectedModel.strategy === 'local-onnx' 
          ? { modelPath: `models/${selectedModel.id}` }
          : {})
      };

      // 创建真实的嵌入服务实例
      const serviceOptions = {
        config: testConfig,
        enableCache: false, // 测试时禁用缓存
        testMode: true // 启用测试模式详细日志
      };

      const embeddingService = new EmbeddingService(serviceOptions);
      
      const startTime = Date.now();
      
      // 初始化服务
      await embeddingService.initialize();
      
      const initTime = Date.now() - startTime;
      
      // 使用真实的测试文本
      const testText = "这是一个测试文本，用于验证嵌入服务是否正常工作。包含中英文 mixed content for comprehensive testing.";
      
      // 实际调用嵌入生成
      const result = await embeddingService.generateEmbedding(testText);
      
      const embedEndTime = Date.now();
      const totalTime = embedEndTime - startTime;
      const embedTime = embedEndTime - startTime;
      
      setTestResult({ 
        success: true, 
        latency: totalTime,
        dimension: result.length 
      });
      
      toast.success(`嵌入服务测试成功！延迟: ${totalTime}ms, 维度: ${result.length}`);
      
      // 清理资源
      await embeddingService.cleanup();
      
    } catch (error) {
      setTestResult({ success: false });
      toast.error(`嵌入服务测试失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsTestingService(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 服务状态和操作 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          {/* 状态指示器 */}
          <div className="flex items-center space-x-3">
            <div className={`w-2 h-2 rounded-full ${
              currentEmbedding?.strategy === 'ollama' 
                ? (ollamaStatus === 'connected' ? 'bg-emerald-400' : 'bg-red-400')
                : 'bg-emerald-400'
            }`} />
            <div className={`w-2 h-2 rounded-full ${
              currentEmbedding ? 'bg-emerald-400' : 'bg-slate-400'
            }`} />
            <div className={`w-2 h-2 rounded-full ${
              testResult === null ? 'bg-slate-400' : 
              testResult.success ? 'bg-emerald-400' : 'bg-red-400'
            }`} />
          </div>
          {testResult?.success && (
            <Badge variant="outline" className="text-emerald-500 border-emerald-300 bg-emerald-50">
              {testResult.latency}ms
            </Badge>
          )}
          {testResult?.success === false && (
            <Badge variant="outline" className="text-red-500 border-red-300 bg-red-50">
              失败
            </Badge>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={testEmbeddingService}
            disabled={isTestingService}
            title="测试"
          >
            {isTestingService ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={checkModelStatus}
            disabled={isLoading}
            title="刷新"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* 策略选择 */}
      <div className="space-y-3">
        
        <div className="flex items-center gap-2">
          <Button
            variant={selectedStrategy === 'ollama' ? 'soft' : 'outline'}
            size="sm"
            onClick={async () => {
              console.log('切换到 Ollama 策略');
              setSelectedStrategy('ollama');
              // 策略切换时立即更新模型列表（独立于当前配置）
              await updateModelListByStrategy('ollama');
            }}
            className="flex items-center space-x-1 h-8"
          >
            <Server className="w-4 h-4" />
            <span>Ollama 服务</span>
          </Button>
          <Button
            variant={selectedStrategy === 'local-onnx' ? 'soft' : 'outline'}
            size="sm"
            onClick={async () => {
              console.log('切换到本地离线推理策略');
              setSelectedStrategy('local-onnx');
              await updateModelListByStrategy('local-onnx');
            }}
            className="flex items-center space-x-1 h-8"
          >
            <HardDrive className="w-4 h-4" />
            <span>本地模型</span>
          </Button>
        </div>

        <p className="text-xs text-gray-600 dark:text-gray-400">
          {getStrategyDescription(selectedStrategy)}
        </p>
      </div>

      {/* 模型列表 */}
      <div className="space-y-3">
        <div className="grid gap-3">
          {models.map((model) => (
            <div
              key={model.id}
              className={`p-4 border rounded-lg transition-all ${
                model.selected
                  ? 'border-slate-400/70 bg-slate-100/60 dark:border-white/20 dark:bg-white/8'
                  : 'border-slate-200/70 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/16'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-2">
                    <h3 className="font-medium">{model.name}</h3>
                    {model.isRecommended && (
                      <Badge variant="secondary" className="text-xs">
                        推荐
                      </Badge>
                    )}
                    <div className="flex items-center space-x-1">
                      {model.status === 'installed' && (
                        <Badge variant="default" className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                          <CheckCircle className="w-3 h-3" />
                        </Badge>
                      )}
                      {model.status === 'downloading' && (
                        <Badge variant="secondary" className="text-xs">
                          <Clock className="w-3 h-3 animate-spin" />
                        </Badge>
                      )}
                      {model.status === 'error' && (
                        <Badge variant="destructive" className="text-xs">
                          <AlertCircle className="w-3 h-3" />
                        </Badge>
                      )}
                      {model.selected && (
                        <Badge variant="secondary" className="text-xs">
                          使用中
                        </Badge>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                    {model.description}
                  </p>
                  <div className="flex items-center space-x-4 text-xs text-gray-500">
                    <span>{model.size}</span>
                    {model.category && (
                      <span>{model.category}</span>
                    )}
                    {model.dimensions && (
                      <span>{model.dimensions}D</span>
                    )}
                  </div>
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="flex items-center space-x-2 mt-3 min-h-[2.5rem]">
                {model.status === 'available' && (
                  <Button
                    size="sm"
                    variant="soft"
                    onClick={() => handleInstallModel(model)}
                    className="flex items-center space-x-1"
                  >
                    <Download className="w-4 h-4" />
                    <span>安装</span>
                  </Button>
                )}
                
                {model.status === 'installed' && (
                  <>
                    {model.selected ? (
                      <Button 
                        size="sm" 
                        variant="soft"
                        disabled 
                        className="flex items-center space-x-1 opacity-60"
                      >
                        <CheckCircle className="w-4 h-4" />
                        <span>已激活</span>
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="soft"
                        onClick={() => handleSelectModel(model)}
                        className="flex items-center space-x-1"
                      >
                        <CheckCircle className="w-4 h-4" />
                        <span>激活</span>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteModel(model)}
                      className="flex items-center space-x-1 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                      disabled={model.selected}
                      title={model.selected ? "无法删除正在使用的模型" : "删除模型"}
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>删除</span>
                    </Button>
                  </>
                )}
                
                {model.status === 'downloading' && (
                  <div className="flex-1 space-y-2">
                    {/* 进度条 */}
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-slate-600 dark:bg-slate-300 h-2 rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${model.downloadProgress || 0}%` }}
                      />
                    </div>
                    {/* 进度文字 */}
                    <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                      <span className="flex items-center space-x-1">
                        <Clock className="w-3 h-3 animate-spin" />
                        <span>{model.downloadHint || '下载中...'}</span>
                      </span>
                      <span className="font-mono">
                        {model.downloadProgress ? `${model.downloadProgress}%` : '0%'}
                      </span>
                    </div>
                  </div>
                )}
                
                {model.status === 'error' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleInstallModel(model)}
                    className="flex items-center space-x-1 text-orange-600 hover:text-orange-700 border-orange-300 hover:border-orange-400"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>重试</span>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 提示信息 */}
      {selectedStrategy === 'ollama' ? (
        <div className="bg-slate-100/55 dark:bg-white/6 border border-slate-200/60 dark:border-white/10 rounded-lg p-3">
          <div className="flex items-start space-x-2">
            <Globe className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-slate-600 dark:text-slate-300">
              <p className="font-medium mb-1">Ollama 使用说明</p>
              <ul className="space-y-1 text-xs">
                <li>• 可连接本地或远端 Ollama API 服务</li>
                <li>• 请在「设置 → AI 模型」中配置 Ollama 服务地址与端口</li>
                <li>• 模型首次调用时自动下载并缓存，可离线推理</li>
              </ul>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-slate-100/55 dark:bg-white/6 border border-slate-200/60 dark:border-white/10 rounded-lg p-3">
          <div className="flex items-start space-x-2">
            <HardDrive className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-slate-600 dark:text-slate-300">
              <p className="font-medium mb-1">本地离线推理</p>
              <ul className="space-y-1 text-xs">
                <li>• 完全本地推理，生成高质量嵌入向量</li>
                <li>• 适用于离线环境或对数据隐私要求极高的场景</li>
                <li>• 无需外部服务或网络连接</li>
                <li>• 生产环境也可直接使用</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 