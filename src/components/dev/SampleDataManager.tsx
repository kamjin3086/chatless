'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/components/ui/sonner';
import { 
  RefreshCw, 
  Trash2, 
  Play, 
  CheckCircle, 
  AlertCircle, 
  Brain, 
  FileText, 
  Database, 
  HardDrive,
  Settings,
  AlertTriangle,
  RotateCcw,
  FolderX
} from 'lucide-react';
import { SampleDataInitializer } from '@/lib/sampleDataInitializer';
import { Alert, AlertDescription } from '@/components/ui/alert';

// 状态接口
interface InitStatus {
  isInitialized: boolean;
  isValid: boolean;
  issues: string[];
  summary: {
    knowledgeBases: number;
    documents: number;
    emptyKnowledgeBases: number;
  };
}

// 初始化进度状态
interface ProgressState {
  isRunning: boolean;
  currentStep: string;
  progress: number;
}

export default function SampleDataManager() {
  const [initStatus, setInitStatus] = useState<InitStatus>({
    isInitialized: false,
    isValid: false,
    issues: [],
    summary: { knowledgeBases: 0, documents: 0, emptyKnowledgeBases: 0 }
  });
  
  const [progressState, setProgressState] = useState<ProgressState>({
    isRunning: false,
    currentStep: '',
    progress: 0
  });

  // 添加确认对话框状态
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // 初始化组件时检查状态
  useEffect(() => {
    checkInitStatus();
  }, []);

  /**
   * 检查初始化状态
   */
  const checkInitStatus = async () => {
    try {
      const isInitialized = await SampleDataInitializer.isInitialized();
      let validationResult: { isValid: boolean; issues: string[]; summary: { knowledgeBases: number; documents: number; emptyKnowledgeBases: number; } } = { 
        isValid: false, 
        issues: [], 
        summary: { knowledgeBases: 0, documents: 0, emptyKnowledgeBases: 0 } 
      };
      
      if (isInitialized) {
        validationResult = await SampleDataInitializer.validateData();
      }

      setInitStatus({
        isInitialized,
        isValid: validationResult.isValid,
        issues: validationResult.issues,
        summary: validationResult.summary
      });
    } catch (error) {
      console.error('检查初始化状态失败:', error);
      toast.error('检查初始化状态失败');
    }
  };

  /**
   * 初始化示例数据
   */
  const handleInitialize = async () => {
    setProgressState({ isRunning: true, currentStep: '准备初始化', progress: 0 });

    try {
      await SampleDataInitializer.initializeAll({
        onProgress: (step: string, progress: number) => {
          setProgressState({ isRunning: true, currentStep: step, progress });
        },
        overrideExisting: false
      });

      toast.success('示例数据初始化成功！');
      await checkInitStatus();
    } catch (error) {
      console.error('初始化失败:', error);
      toast.error(`❌ 初始化失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setProgressState({ isRunning: false, currentStep: '', progress: 0 });
    }
  };

  /**
   * 重新初始化示例数据
   */
  const handleReinitialize = async () => {
    if (!confirm('⚠️ 确定要重新初始化示例数据吗？\n\n这会重新创建示例知识库和文档。')) {
      return;
    }

    setProgressState({ isRunning: true, currentStep: '准备重新初始化', progress: 0 });

    try {
      await SampleDataInitializer.resetInitialization();
      await SampleDataInitializer.initializeAll({
        onProgress: (step: string, progress: number) => {
          setProgressState({ isRunning: true, currentStep: step, progress });
        },
        overrideExisting: true
      });

      toast.success('示例数据重新初始化成功！');
      await checkInitStatus();
    } catch (error) {
      console.error('重新初始化失败:', error);
      toast.error(`❌ 重新初始化失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setProgressState({ isRunning: false, currentStep: '', progress: 0 });
    }
  };

  /**
   * 清理初始化标记
   */
  const handleClearFlag = async () => {
    try {
      await SampleDataInitializer.resetInitialization();
      toast.success('初始化标记已清理');
      await checkInitStatus();
    } catch (error) {
      console.error('清理失败:', error);
      toast.error(`❌ 清理失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  /**
   * 显示完整重置确认对话框
   */
  const handleShowResetConfirm = () => {
    setShowResetConfirm(true);
  };

  /**
   * 确认执行完整重置
   */
  const handleConfirmFullReset = async () => {
    setShowResetConfirm(false);
    setProgressState({ isRunning: true, currentStep: '准备完整重置', progress: 0 });

    try {
      console.log('🗑️ 开始执行完整重置...');
      
      await SampleDataInitializer.fullReset({
        onProgress: (s, p) => setProgressState({ isRunning: true, currentStep: s, progress: p })
      });
      await SampleDataInitializer.initializeAll({
        onProgress: (s, p) => setProgressState({ isRunning: true, currentStep: s, progress: p })
      });
      toast.success('重置完成，请手动重启应用以确保所有缓存被清理');
    } catch (error) {
      console.error('❌ 完整重置失败:', error);
      toast.error(`❌ 完整重置失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setProgressState({ isRunning: false, currentStep: '', progress: 0 });
    }
  };

  /**
   * 取消完整重置
   */
  const handleCancelFullReset = () => {
    setShowResetConfirm(false);
  };

  // Note: getStatistics method was removed as it's not implemented in SampleDataInitializer
  // Statistics are now obtained through checkInitStatus which calls validateData

  return (
    <div className="space-y-6">
      {/* 确认对话框 */}
      {showResetConfirm && (
        <div className="fixed inset-0 glass-scrim bg-black/60 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                危险操作确认
              </CardTitle>
              <CardDescription>
                请仔细阅读以下信息，此操作不可撤销
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-3">
                    <div className="font-medium">完整重置将会删除：</div>
                    <ul className="list-disc list-inside text-sm space-y-1">
                      <li>所有知识库和文档数据</li>
                      <li>所有聊天记录和对话历史</li>
                      <li>所有Tauri存储数据</li>
                      <li>所有文档文件和目录</li>
                      <li>所有应用配置和设置</li>
                    </ul>
                    <div className="text-destructive font-medium">
                      ⚠️ 应用将恢复到全新安装状态，所有数据将永久丢失！
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
              
              <div className="flex gap-3 justify-end">
                <Button 
                  onClick={handleCancelFullReset}
                  variant="outline"
                >
                  取消
                </Button>
                <Button 
                  onClick={handleConfirmFullReset}
                  variant="destructive"
                  className="min-w-[100px]"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  确认重置
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 主要功能区 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            示例数据管理
          </CardTitle>
          <CardDescription>
            管理示例知识库和文档，用于快速体验应用功能
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 当前状态 */}
          <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-3">
              {initStatus.isInitialized ? (
                initStatus.isValid ? (
                  <>
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <div>
                      <div className="font-medium">示例数据已就绪</div>
                      <div className="text-sm text-muted-foreground">
                        {initStatus.summary.knowledgeBases} 个知识库，{initStatus.summary.documents} 个文档
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-5 w-5 text-yellow-600" />
                    <div>
                      <div className="font-medium">示例数据存在问题</div>
                      <div className="text-sm text-muted-foreground">
                        发现 {initStatus.issues.length} 个问题需要处理
                      </div>
                    </div>
                  </>
                )
              ) : (
                <>
                  <AlertCircle className="h-5 w-5 text-slate-500" />
                  <div>
                    <div className="font-medium">示例数据未初始化</div>
                    <div className="text-sm text-muted-foreground">
                      点击下方按钮创建示例数据
                    </div>
                  </div>
                </>
              )}
            </div>
            
            <Button 
              onClick={checkInitStatus} 
              disabled={progressState.isRunning}
              variant="ghost"
              size="sm"
              className="shrink-0"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          {/* 主要操作 */}
          <div className="space-y-4">
            {!initStatus.isInitialized ? (
              <Button 
                onClick={handleInitialize} 
                disabled={progressState.isRunning}
                className="w-full"
                size="lg"
              >
                <Play className="h-5 w-5 mr-2" />
                创建示例数据
              </Button>
            ) : (
              <Button 
                onClick={handleReinitialize} 
                disabled={progressState.isRunning}
                variant="outline"
                className="w-full"
                size="lg"
              >
                <RotateCcw className="h-5 w-5 mr-2" />
                重新创建示例数据
              </Button>
            )}
          </div>

          {/* 问题提示 */}
          {initStatus.issues.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <div className="font-medium">发现以下问题：</div>
                  <ul className="list-disc list-inside text-sm space-y-1">
                    {initStatus.issues.slice(0, 3).map((issue, index) => (
                      <li key={index}>{issue}</li>
                    ))}
                    {initStatus.issues.length > 3 && (
                      <li className="text-muted-foreground">... 还有 {initStatus.issues.length - 3} 个问题</li>
                    )}
                  </ul>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* 进度显示 */}
      {progressState.isRunning && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">处理进度</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{progressState.currentStep}</span>
                <span>{Math.round(progressState.progress)}%</span>
              </div>
              <Progress value={progressState.progress} className="w-full" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* 数据重置区 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            数据重置
          </CardTitle>
          <CardDescription>
            危险操作：谨慎使用以下重置功能
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 轻量重置 */}
            <div className="space-y-3 p-4 border rounded-lg">
              <div className="flex items-center gap-2">
                <RotateCcw className="h-4 w-4 text-orange-600" />
                <div className="font-medium">清理初始化标记</div>
              </div>
              <div className="text-sm text-muted-foreground">
                仅清除初始化状态，保留所有数据和配置
              </div>
              <Button 
                onClick={handleClearFlag} 
                disabled={progressState.isRunning}
                variant="outline"
                size="sm"
                className="w-full"
              >
                清理标记
              </Button>
            </div>

            {/* 完整重置 */}
            <div className="space-y-3 p-4 border border-destructive/20 rounded-lg bg-destructive/5">
              <div className="flex items-center gap-2">
                <FolderX className="h-4 w-4 text-destructive" />
                <div className="font-medium text-destructive">完整重置</div>
              </div>
              <div className="text-sm text-muted-foreground">
                删除所有数据、存储、文件和配置
              </div>
              <Button 
                onClick={handleShowResetConfirm} 
                disabled={progressState.isRunning}
                variant="destructive"
                size="sm"
                className="w-full"
              >
                <AlertTriangle className="h-3 w-3 mr-1" />
                完整重置
              </Button>
            </div>
          </div>

          <div className="border-t border-muted"></div>

          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2">
                <div className="font-medium">重置功能说明：</div>
                <ul className="text-sm space-y-1">
                  <li><strong>清理标记</strong>：允许重新运行示例数据初始化</li>
                  <li><strong>完整重置</strong>：清空数据库、Tauri存储、文档文件、应用配置，恢复到全新安装状态</li>
                </ul>
              </div>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* 示例数据预览 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            示例数据预览
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <div className="text-2xl font-bold text-primary">{initStatus.summary.knowledgeBases}</div>
              <div className="text-sm text-muted-foreground">知识库</div>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <div className="text-2xl font-bold text-primary">{initStatus.summary.documents}</div>
              <div className="text-sm text-muted-foreground">示例文档</div>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <div className="text-2xl font-bold text-primary">3</div>
              <div className="text-sm text-muted-foreground">文件类型</div>
            </div>
          </div>

          <Alert>
            <Settings className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2">
                <div className="font-medium">使用流程：</div>
                <ol className="list-decimal list-inside text-sm space-y-1">
                  <li>创建示例数据（空知识库 + 示例文档）</li>
                  <li>在【设置】中配置嵌入生成服务</li>
                  <li>在【知识库】中添加示例文档到知识库</li>
                  <li>等待文档索引完成后即可在聊天中使用</li>
                </ol>
              </div>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
} 