"use client";

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Brain,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Settings,
  Zap,
  Clock,
  X,
  Info
} from 'lucide-react';
import { EmbeddingService } from '@/lib/embedding/EmbeddingService';
import type { EmbeddingConfig, EmbeddingServiceOptions } from '@/lib/embedding/types';
import { getKnowledgeBaseConfigManager } from '@/lib/knowledgeBaseConfig';

interface EmbeddingServiceStatusProps {
  // 组件现在自管理配置，不需要外部 props
}

interface ServiceStatus {
  isConnected: boolean;
  isInitialized: boolean;
  strategy: string;
  inferenceSource?: 'real' | 'mock' | 'unavailable' | 'ollama' | 'unknown';
  model?: string;
  latency?: number;
  error?: string;
  dimension?: number;
}

interface TestResult {
  success: boolean;
  latency: number;
  dimension: number;
  inferenceSource?: 'real' | 'mock' | 'unavailable' | 'ollama' | 'unknown';
  error?: string;
}

export function EmbeddingServiceStatus({}: EmbeddingServiceStatusProps) {
  const [status, setStatus] = useState<ServiceStatus>({
    isConnected: false,
    isInitialized: false,
    strategy: 'unknown'
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [currentConfig, setCurrentConfig] = useState<EmbeddingConfig | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const probeVersion = useRef(0);

  // 安全的模型名称处理函数：确保不会泄露任何路径信息
  const getSafeModelName = (config: EmbeddingConfig): string => {
    if (config.strategy === 'ollama') {
      return config.modelName || 'Ollama 模型';
    }

    // 对于本地模型，只返回友好的名称，绝不返回路径
    if (config.modelName) {
      return config.modelName;
    }

    // 如果有路径信息，提取并美化文件名，但移除所有路径信息
    if (config.modelPath) {
      const fileName = config.modelPath.split('/').pop() || config.modelPath.split('\\').pop() || '';
      if (fileName) {
        let displayName = fileName.replace(/\.(onnx|bin)$/i, '');

        // 美化常见的模型名称
        displayName = displayName
          .replace(/^all-/, '')
          .replace(/-v\d+$/, '')
          .replace(/minilm/i, 'MiniLM')
          .replace(/l(\d+)/i, 'L$1')
          .replace(/-/g, ' ');

        return displayName || '本地模型';
      }
    }

    return '本地模型';
  };

  // 从配置管理器加载配置
  const loadConfigFromManager = async () => {
    try {
      // 从配置管理器获取当前配置
      const configManager = getKnowledgeBaseConfigManager();
      await configManager.ensureLoaded();
      const knowledgeConfig = configManager.getConfig();

      // 将知识库配置转换为 EmbeddingConfig
      const embeddingConfig: EmbeddingConfig = {
        strategy: knowledgeConfig.embedding.strategy,
        modelPath: knowledgeConfig.embedding.modelPath,
        modelName: knowledgeConfig.embedding.modelName,
        tokenizerPath: knowledgeConfig.embedding.tokenizerPath,
        apiUrl: knowledgeConfig.embedding.apiUrl,
        timeout: knowledgeConfig.embedding.timeout,
        maxBatchSize: knowledgeConfig.embedding.maxBatchSize,
        maxLength: knowledgeConfig.embedding.maxLength,
      };

      setCurrentConfig(embeddingConfig);
      setTestResult(null);

      return embeddingConfig;
    } catch (error) {
      console.error('[EmbeddingServiceStatus] 加载配置失败:', error);
      // 返回默认配置
      const defaultConfig: EmbeddingConfig = {
        strategy: 'ollama',
        apiUrl: 'http://localhost:11434',
        modelName: 'nomic-embed-text'
      };
      setCurrentConfig(defaultConfig);
      return defaultConfig;
    }
  };

  // 检查服务状态
  const checkServiceStatus = async (config?: EmbeddingConfig) => {
    const version = ++probeVersion.current;
    let embeddingService: EmbeddingService | undefined;
    setIsLoading(true);
    setStatus(prev => ({ ...prev, error: undefined }));

    try {
      let testConfig = config || currentConfig;

      // 如果没有配置，先加载动态配置
      if (!testConfig) {
        testConfig = await loadConfigFromManager();
      }

      // 创建临时的嵌入服务实例进行测试
      const serviceOptions: EmbeddingServiceOptions = {
        config: testConfig,
        enableCache: false // 测试时禁用缓存
      };

      embeddingService = new EmbeddingService(serviceOptions);

      // 尝试初始化服务
      await embeddingService.initialize();

      const newStatus: ServiceStatus = {
        isConnected: true,
        isInitialized: embeddingService.isInitialized(),
        strategy: embeddingService.getUserFriendlyStrategyName(),
        inferenceSource: embeddingService.getEmbeddingSource(),
        dimension: embeddingService.getDimension(),
        model: getSafeModelName(testConfig)
      };

      if (version !== probeVersion.current) return;
      setStatus(newStatus);
      if (embeddingService.isUsableForRag()) {
        const fingerprint = embeddingService.getEmbeddingFingerprint();
        void import('@/lib/rag/ragServiceInstance').then(({ reconcileEmbeddingProbe }) =>
          reconcileEmbeddingProbe(testConfig, fingerprint)
        ).catch((error) => console.warn('[EmbeddingServiceStatus] Runtime reconciliation failed:', error));
      }

    } catch (error) {
      console.error('嵌入服务状态检查失败:', error);
      if (version !== probeVersion.current) return;
      setStatus({
        isConnected: false,
        isInitialized: false,
        strategy: currentConfig?.strategy || 'unknown',
        error: error instanceof Error ? error.message : '未知错误'
      });
    } finally {
      await embeddingService?.cleanup().catch((error) => console.warn('[EmbeddingServiceStatus] Probe cleanup failed:', error));
      if (version === probeVersion.current) setIsLoading(false);
    }
  };

  // 测试嵌入生成
  const testEmbeddingGeneration = async () => {
    if (!currentConfig) {
      await loadConfigFromManager();
      return;
    }

    const version = ++probeVersion.current;
    let embeddingService: EmbeddingService | undefined;
    setIsLoading(false);
    setIsTesting(true);
    setTestResult(null);

    try {
      const serviceOptions: EmbeddingServiceOptions = {
        config: currentConfig,
        enableCache: false
      };

      embeddingService = new EmbeddingService(serviceOptions);

      const startTime = Date.now();
      await embeddingService.initialize();

      // 测试文本
      const testText = "这是一个测试文本，用于验证嵌入服务是否正常工作。";

      const result = await embeddingService.generateEmbedding(testText);
      const endTime = Date.now();
      if (version !== probeVersion.current) return;

      const inferenceSource = embeddingService.getEmbeddingSource();

      setTestResult({
        success: true,
        latency: endTime - startTime,
        dimension: result.length,
        inferenceSource,
      });

      // 更新状态
      setStatus(prev => ({
        ...prev,
        latency: endTime - startTime,
        dimension: result.length,
        inferenceSource,
      }));
      const fingerprint = embeddingService.getEmbeddingFingerprint();
      void import('@/lib/rag/ragServiceInstance').then(({ reconcileEmbeddingProbe }) =>
        reconcileEmbeddingProbe(currentConfig, fingerprint)
      ).catch((error) => console.warn('[EmbeddingServiceStatus] Runtime reconciliation failed:', error));

    } catch (error) {
      console.error('嵌入生成测试失败:', error);
      if (version !== probeVersion.current) return;
      setTestResult({
        success: false,
        latency: 0,
        dimension: 0,
        error: error instanceof Error ? error.message : '测试失败'
      });
    } finally {
      await embeddingService?.cleanup().catch((error) => console.warn('[EmbeddingServiceStatus] Test cleanup failed:', error));
      setIsTesting(false);
    }
  };

  // 刷新配置和状态
  const refreshAll = async () => {
    const config = await loadConfigFromManager();
    await checkServiceStatus(config);
  };

  // 初始化时加载配置和检查状态
  useEffect(() => {
    let active = true;
    void loadConfigFromManager().then((config) => { if (active) void checkServiceStatus(config); });
    return () => { active = false; probeVersion.current++; };
  }, []);

  // 监听配置管理器的变化
  useEffect(() => {
    const configManager = getKnowledgeBaseConfigManager();

    let active = true;
    const handleConfigChange = () => {
      void loadConfigFromManager().then((config) => { if (active) void checkServiceStatus(config); });
    };

    configManager.addListener(handleConfigChange);

    return () => {
      active = false;
      configManager.removeListener(handleConfigChange);
    };
  }, []);

  const getStatusBadge = () => {
    if (isLoading || isTesting) return <Badge variant="outline" className="text-muted-foreground">检查中</Badge>;
    if (status.isInitialized && status.inferenceSource === 'unavailable') {
      return <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">语义不可用（词法可用）</Badge>;
    }
    if (!status.isConnected) {
      return <Badge variant="outline" className="text-red-500 border-red-300 bg-red-50">离线</Badge>;
    }
    if (!status.isInitialized) {
      return <Badge variant="outline" className="text-amber-500 border-amber-300 bg-amber-50">未初始化</Badge>;
    }
    return <Badge variant="outline" className="text-emerald-500 border-emerald-300 bg-emerald-50">正常</Badge>;
  };

  const getTestResultBadge = () => {
    if (!testResult) {
      return null; // 不显示徽章，减少视觉干扰
    }
    if (testResult.success) {
      return <Badge variant="outline" className="text-emerald-500 border-emerald-300 bg-emerald-50">{testResult.latency}ms</Badge>;
    }
    return <Badge variant="outline" className="text-red-500 border-red-300 bg-red-50">失败</Badge>;
  };

  return (
    <div className="space-y-4">
      {/* 标题行：标题 + 状态 + 详情图标 + 刷新 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Brain className="w-5 h-5 text-slate-500" />
          <h3 className="text-lg font-medium">嵌入服务状态</h3>
          {getStatusBadge()}
        </div>
        <div className="flex items-center space-x-2">
          {/* 详情图标 */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDetails(!showDetails)}
            className="p-1 h-8 w-8"
            title="查看详细信息"
          >
            <Info className="w-4 h-4" />
          </Button>
          {/* 刷新按钮 */}
          <Button
            variant="outline"
            size="sm"
            onClick={refreshAll}
            disabled={isLoading}
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </div>

      {/* 详细信息（可折叠） */}
      {showDetails && (
        <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 space-y-2">
          <h4 className="font-medium text-sm text-slate-900 dark:text-slate-100">服务详情</h4>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-slate-600 dark:text-slate-400">服务类型</span>
              <span className="font-medium">{status.strategy}</span>
            </div>

            {status.inferenceSource && status.inferenceSource !== 'unknown' && (
              <div className="flex justify-between items-center">
                <span className="text-slate-600 dark:text-slate-400">推理来源</span>
                <span className={`font-medium ${status.inferenceSource === 'mock' || status.inferenceSource === 'unavailable' ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {status.inferenceSource === 'real'
                    ? '真实 ONNX'
                    : status.inferenceSource === 'mock'
                      ? '模拟向量（测试/回退）'
                      : status.inferenceSource === 'unavailable'
                        ? '不可用（词法检索仍可用）'
                        : 'Ollama'}
                </span>
              </div>
            )}

            {status.model && (
              <div className="flex justify-between items-center">
                <span className="text-slate-600 dark:text-slate-400">当前模型</span>
                <span className="font-medium">{status.model}</span>
              </div>
            )}

            {status.dimension && (
              <div className="flex justify-between items-center">
                <span className="text-slate-600 dark:text-slate-400">向量维度</span>
                <span className="font-medium">{status.dimension}D</span>
              </div>
            )}

            {status.latency && (
              <div className="flex justify-between items-center">
                <span className="text-slate-600 dark:text-slate-400">响应时间</span>
                <span className="font-medium">{status.latency}ms</span>
              </div>
            )}
          </div>

          {status.error && (
            <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-sm text-red-700 dark:text-red-300">
              <div className="flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{status.error}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 简洁的策略选择 */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
          嵌入服务类型
        </label>
        <p className="text-sm text-slate-700 dark:text-slate-300">
          {currentConfig?.strategy === 'local-onnx' ? '本地模型' : currentConfig?.strategy === 'ollama' ? 'Ollama 服务' : '未配置'}
        </p>
        <p className="text-xs text-muted-foreground">在上方模型管理器中激活模型以切换服务类型。</p>
      </div>

      {/* 功能测试 */}
      <div className="space-y-3">
        {getTestResultBadge() && (
          <div className="flex justify-end">
            {getTestResultBadge()}
          </div>
        )}

        <Button
          onClick={testEmbeddingGeneration}
          disabled={!status.isInitialized || isTesting}
          variant="outline"
          className="w-full"
          size="sm"
        >
          {isTesting ? (
            <>
              <Clock className="w-4 h-4 mr-2 animate-spin" />
              正在测试...
            </>
          ) : (
            <>
              <Zap className="w-4 h-4 mr-2" />
              测试嵌入生成
            </>
          )}
        </Button>

        {testResult && !testResult.success && (
          <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-sm text-red-700 dark:text-red-300">
            {testResult.error}
          </div>
        )}
      </div>

      {/* 状态指示器 - 简化为仅显示圆点 */}
      <div className="flex items-center justify-center space-x-4 py-2">
        <div
          className={`w-2 h-2 rounded-full ${status.isConnected ? 'bg-emerald-400' : 'bg-red-400'}`}
          title={status.isConnected ? '服务已连接' : '服务连接失败'}
        />
        <div
          className={`w-2 h-2 rounded-full ${status.isInitialized ? 'bg-emerald-400' : 'bg-slate-400'}`}
          title={status.isInitialized ? '服务已初始化' : '服务未初始化'}
        />
        <div
          className={`w-2 h-2 rounded-full ${testResult?.success ? 'bg-emerald-400' : 'bg-slate-400'}`}
          title={testResult?.success ? '测试已通过' : '尚未测试'}
        />
      </div>
    </div>
  );
}
