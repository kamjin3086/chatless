'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addRecentRoute, getRecentRoutes } from '@/lib/recentRoutes';
import SampleDataManager from '@/components/dev/SampleDataManager';
import { DatabaseRepairTool } from '@/components/dev/DatabaseRepairTool';
import { PerformanceMonitor } from '@/components/dev/PerformanceMonitor';
import { PerformanceReport } from '@/components/dev/PerformanceReport';
import { getDevToolsStatus } from '../../lib/utils/environment';
import { Button } from '@/components/ui/button';
import { Loader2, RotateCcw, RefreshCw, AlertTriangle, Database, Trash2, ChevronDown, ChevronUp, Settings, FolderOpen } from 'lucide-react';
import FoldingLoader from '@/components/ui/FoldingLoader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SampleDataInitializer } from "@/lib/sampleDataInitializer";
import { specializedStorage } from "@/lib/storage";
import { GoogleAIProvider } from "@/lib/llm/providers/GoogleAIProvider";

interface DevToolsStatus {
  isDevEnv: boolean;
  isTauriApp: boolean;
  canUseDevTools: boolean;
}

export default function DevToolsPage() {
  const router = useRouter();
  const [status, setStatus] = useState<DevToolsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [isResetting, setIsResetting] = useState(false);
  const [isReinitializing] = useState(false);
  const [isCleaning] = useState(false);
  const [isCheckingLock, setIsCheckingLock] = useState(false);
  const [lockStatus, setLockStatus] = useState<{
    hasLock: boolean;
    isExpired: boolean;
    lockTime?: string;
  } | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [message, setMessage] = useState("");
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const [googleTestResult, setGoogleTestResult] = useState<string>('');
  const [isTestingGoogle, setIsTestingGoogle] = useState(false);
  const [appDataPath, setAppDataPath] = useState<string>('');
  const [jumpPath, setJumpPath] = useState<string>('');
  const [recents, setRecents] = useState<{ path: string; title?: string; ts: number }[]>([]);
  const [vectorStats, setVectorStats] = useState<{
    totalVectors: number;
    activeVectors: number;
    deletedVectors: number;
    orphanedVectors: number;
  } | null>(null);
  const [isLoadingVectorStats, setIsLoadingVectorStats] = useState(false);
  const [isCleaningVectors, setIsCleaningVectors] = useState(false);
  const [vectorMessage, setVectorMessage] = useState('');

  // 知识库配置管理状态
  const [configInfo, setConfigInfo] = useState<{
    current: any;
    default: any;
  } | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [isResettingConfig, setIsResettingConfig] = useState(false);
  const [configMessage, setConfigMessage] = useState('');

  const handleNavigate = () => {
    const p = (jumpPath || '').trim();
    if (!p) return;
    // 只允许站内相对路径
    if (p.startsWith('http://') || p.startsWith('https://')) return;
    const dest = p.startsWith('/') ? p : `/${p}`;
    addRecentRoute(dest);
    setRecents(getRecentRoutes());
    router.push(dest);
  };

  useEffect(() => {
    setRecents(getRecentRoutes());
  }, []);

  // 移除未使用的 handleResetSampleData

  const handleFullReset = async () => {
    if (!confirm("⚠️ 这将删除所有数据（数据库、文件、配置）确定要继续吗？")) {
      return;
    }
    
    if (!confirm("⚠️ 最后确认：这是不可逆的操作，将删除所有数据")) {
      return;
    }

    setIsResetting(true);
    setProgress(0);
    setCurrentStep("开始重置...");
    setMessage("");

    try {
      await SampleDataInitializer.fullReset({
        onProgress: (step, prog) => {
          setCurrentStep(step);
          setProgress(prog);
        }
      });
      
      setMessage("完全重置成功");
      
      // 2秒后重新加载页面
      setTimeout(() => {
        window.location.reload();
      }, 2000);

    } catch (error) {
      console.error('重置失败:', error);
      setMessage(`❌ 重置失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsResetting(false);
      setProgress(100);
    }
  };

  // 移除未使用的 handleReinitialize（保留完全重置）

  // 移除未使用的 handleCleanupDuplicates

  const handleCheckLock = async () => {
    setIsCheckingLock(true);
    try {
      const lock = await specializedStorage.sampleData.getLock();
      const isExpired = await specializedStorage.sampleData.isLockExpired();
      
      setLockStatus({
        hasLock: !!lock,
        isExpired,
        lockTime: lock ? new Date(parseInt(lock)).toLocaleString() : undefined
      });
      
      if (lock) {
        setMessage(`🔍 发现初始化锁: ${isExpired ? '已过期' : '有效'}, 创建时间: ${new Date(parseInt(lock)).toLocaleString()}`);
      } else {
        setMessage('未发现初始化锁');
      }
    } catch (error) {
      console.error('检查锁状态失败:', error);
      setMessage(`❌ 检查锁状态失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsCheckingLock(false);
    }
  };

  const handleClearLock = async () => {
    try {
      await specializedStorage.sampleData.forceClearLock();
      setMessage('初始化锁已清除');
      setLockStatus(null);
    } catch (error) {
      console.error('清除锁失败:', error);
      setMessage(`❌ 清除锁失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleGetVectorStats = async () => {
    setIsLoadingVectorStats(true);
    setVectorMessage('');
    
    try {
      const { KnowledgeService } = await import('@/lib/knowledgeService');
      const stats = await KnowledgeService.getVectorStats();
      setVectorStats(stats);
      
      if (stats.orphanedVectors > 0) {
        setVectorMessage(`⚠️ 发现 ${stats.orphanedVectors} 个孤立向量，建议清理`);
      } else {
        setVectorMessage('✅ 没有发现孤立向量');
      }
    } catch (error) {
      console.error('获取向量统计失败:', error);
      setVectorMessage(`❌ 获取统计失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoadingVectorStats(false);
    }
  };

  const handleCleanupVectors = async () => {
    if (!vectorStats?.orphanedVectors) {
      setVectorMessage('没有需要清理的孤立向量');
      return;
    }

    if (!confirm(`确定要清理 ${vectorStats.orphanedVectors} 个孤立向量吗？`)) {
      return;
    }

    setIsCleaningVectors(true);
    setVectorMessage('');

    try {
      const { KnowledgeService } = await import('@/lib/knowledgeService');
      const cleanedCount = await KnowledgeService.cleanupOrphanedVectors();
      
      setVectorMessage(`✅ 清理完成，处理了 ${cleanedCount} 个孤立向量`);
      
      // 重新获取统计信息
      setTimeout(() => {
        handleGetVectorStats();
      }, 1000);
      
    } catch (error) {
      console.error('清理向量失败:', error);
      setVectorMessage(`❌ 清理失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsCleaningVectors(false);
    }
  };

  // 知识库配置管理函数
  const handleShowKnowledgeBaseConfig = async () => {
    setIsLoadingConfig(true);
    setConfigMessage('');
    
    try {
      const { devShowKnowledgeBaseConfig } = await import('@/lib/__admin__/devTools');
      await devShowKnowledgeBaseConfig();
      
      // 获取配置信息用于显示
      const { getKnowledgeBaseConfigManager, DEFAULT_KNOWLEDGE_BASE_CONFIG } = await import('@/lib/knowledgeBaseConfig');
      const configManager = getKnowledgeBaseConfigManager();
      const currentConfig = configManager.getConfig();
      
      setConfigInfo({
        current: currentConfig,
        default: DEFAULT_KNOWLEDGE_BASE_CONFIG
      });
      
      setConfigMessage('✅ 配置信息已加载');
    } catch (error) {
      console.error('获取配置信息失败:', error);
      setConfigMessage(`❌ 获取配置失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoadingConfig(false);
    }
  };

  const handleResetKnowledgeBaseConfig = async () => {
    if (!confirm('⚠️ 这将重置知识库配置为默认值，确定要继续吗？')) {
      return;
    }

    setIsResettingConfig(true);
    setConfigMessage('');

    try {
      const { devResetKnowledgeBaseConfig } = await import('@/lib/__admin__/devTools');
      const success = await devResetKnowledgeBaseConfig();
      
      if (success) {
        setConfigMessage('✅ 知识库配置已重置为默认值');
        setConfigMessage(prevMessage => prevMessage + '\n⚠️ 建议重新生成所有向量数据以确保维度一致性');
        
        // 重新加载配置信息
        setTimeout(() => {
          handleShowKnowledgeBaseConfig();
        }, 1000);
      } else {
        setConfigMessage('❌ 配置重置失败');
      }
    } catch (error) {
      console.error('重置配置失败:', error);
      setConfigMessage(`❌ 重置失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsResettingConfig(false);
    }
  };

  const handleTestGoogleAI = async () => {
    setIsTestingGoogle(true);
    setGoogleTestResult('');
    
    try {
      // 创建Google AI Provider实例
      const provider = new GoogleAIProvider('https://generativelanguage.googleapis.com/v1beta');
      
      // 设置API密钥（这里需要用户输入）
      const apiKey = prompt('请输入Google AI API密钥:');
      if (!apiKey) {
        setGoogleTestResult('❌ 未提供API密钥');
        return;
      }
      
      // 设置API密钥到KeyManager
      const { KeyManager } = await import('@/lib/llm/KeyManager');
      await KeyManager.setProviderKey('Google AI', apiKey);
      
      // 测试连接
      setGoogleTestResult('🔍 测试连接中...');
      const connectionResult = await provider.checkConnection();
      
      if (!connectionResult.ok) {
        setGoogleTestResult(`❌ 连接失败: ${connectionResult.message}`);
        return;
      }
      
      setGoogleTestResult('✅ 连接成功开始测试流式响应...');
      
      // 测试流式响应
      let streamedContent = '';
      await provider.chatStream(
        'gemini-2.5-flash',
        [{ role: 'user', content: '请用一句话介绍自己' }],
        {
          onStart: () => {
            setGoogleTestResult('🚀 流式响应开始...');
          },
          onToken: (token) => {
            streamedContent += token;
            setGoogleTestResult(`📝 流式内容: ${streamedContent}`);
          },
          onComplete: () => {
            setGoogleTestResult(`✅ 流式响应完成最终内容: ${streamedContent}`);
          },
          onError: (error) => {
            setGoogleTestResult(`❌ 流式响应错误: ${error.message}`);
          }
        }
      );
      
    } catch (error) {
      setGoogleTestResult(`❌ 测试失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsTestingGoogle(false);
    }
  };

  useEffect(() => {
    const checkEnvironment = async () => {
      try {
        const envStatus = await getDevToolsStatus();
        setStatus(envStatus);
      } catch (error) {
        console.error('环境检测失败:', error);
        setStatus({
          isDevEnv: false,
          isTauriApp: false,
          canUseDevTools: false
        });
      } finally {
        setLoading(false);
      }
    };

    checkEnvironment();
    // 预读应用数据目录
    (async () => {
      try {
        const { appDataDir } = await import('@tauri-apps/api/path');
        const dir = await appDataDir();
        setAppDataPath(dir);
      } catch {
        // no-op
      }
    })();
  }, []);

  const handleOpenAppDataDir = async () => {
    try {
      const { appDataDir } = await import('@tauri-apps/api/path');
      // @ts-expect-error - opener 插件仅在 Tauri 环境存在
      const { openPath, open } = await import('@tauri-apps/plugin-opener');
      const dir = await appDataDir();
      if (openPath) {
        await openPath(dir);
      } else if (open) {
        await open(dir);
      }
    } catch (error) {
      console.error('打开应用数据目录失败:', error);
      alert('打开数据目录失败，请检查 Tauri 插件配置');
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex flex-col items-center gap-3 py-10">
          <FoldingLoader size={40} />
          <div className="text-center">
            <h1 className="text-2xl font-bold">开发工具</h1>
            <p className="text-muted-foreground mt-2">正在检测环境...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!status?.canUseDevTools) {
    return (
      <div className="container mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">开发工具</h1>
          <p className="text-muted-foreground">
            数据库管理和开发辅助工具
          </p>
        </div>
        
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6 mb-6">
          <div className="flex items-start gap-3">
            <div className="text-yellow-600 dark:text-yellow-400 text-xl">⚠️</div>
            <div>
              <h2 className="text-lg font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
                环境限制
              </h2>
              <p className="text-yellow-700 dark:text-yellow-300 mb-3">
                开发工具需要在Tauri应用的开发环境中运行。
              </p>
              <div className="bg-yellow-100 dark:bg-yellow-900/40 rounded-md p-3 mb-3">
                <div className="text-sm space-y-1">
                  <div><strong>开发环境:</strong> {status?.isDevEnv ? '是' : '否'}</div>
                  <div><strong>Tauri应用:</strong> {status?.isTauriApp ? '是' : '否'}</div>
                  {!status?.isDevEnv && <div className="text-orange-600">⚠️ 当前为生产环境，开发工具不可用</div>}
                  {!status?.isTauriApp && <div className="text-orange-600">⚠️ 未检测到Tauri应用环境</div>}
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <p className="font-medium">要使用开发工具，请确保：</p>
                <ol className="list-decimal list-inside space-y-1 text-yellow-700 dark:text-yellow-300">
                  <li>应用在开发模式下运行：<code className="bg-yellow-200 dark:bg-yellow-800 px-1 rounded-md">pnpm tauri dev</code></li>
                  <li>在Tauri应用中访问（而非独立浏览器）</li>
                  <li>或者使用终端命令进行数据库操作（见下方）</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
        
        <div className="mt-8 p-4 bg-muted rounded-lg">
          <h2 className="text-lg font-semibold mb-2">替代方案：终端命令</h2>
          <p className="text-sm text-muted-foreground mb-2">
            你可以在终端中使用以下命令进行数据库操作：
          </p>
          <div className="space-y-1 font-mono text-sm bg-black text-green-400 p-3 rounded-md">
            <div><span className="text-slate-400">#</span> 完全重置数据库</div>
            <div>pnpm dev:db:reset</div>
            <div className="mt-2"><span className="text-slate-400">#</span> 重置并添加测试数据</div>
            <div>pnpm dev:db:reset-test</div>
            <div className="mt-2"><span className="text-slate-400">#</span> 清理数据（保留表结构）</div>
            <div>pnpm dev:db:clear</div>
            <div className="mt-2"><span className="text-slate-400">#</span> 显示开发工具菜单</div>
            <div>pnpm dev:db:menu</div>
          </div>
        </div>
      </div>
    );
  }

  const isAnyOperationRunning = isResetting || isReinitializing || isCleaning || isCheckingLock;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center space-x-2">
        <Database className="h-6 w-6" />
        <h1 className="text-2xl font-bold">开发工具</h1>
        <Badge variant="outline">仅用于开发和测试</Badge>
      </div>

      {/* 顶部快速路由跳转（本地化） */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2"><FolderOpen className="h-5 w-5" /> 快速跳转</CardTitle>
            <CardDescription>输入站内相对路径或选择最近访问页面</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              className="border px-2 py-1 rounded-md w-full"
              placeholder="/dev-tools/mcp-test"
              value={jumpPath}
              onChange={(e)=>setJumpPath(e.target.value)}
            />
            <Button onClick={handleNavigate} variant="default">跳转</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* 常用入口本地化 */}
            <Button variant="secondary" size="sm" onClick={()=>{ setJumpPath('/dev-tools/mcp-test'); handleNavigate(); }}>MCP 测试</Button>
            <Button variant="secondary" size="sm" onClick={()=>{ setJumpPath('/dev-tools/http'); handleNavigate(); }}>HTTP 测试</Button>
            <Button variant="secondary" size="sm" onClick={()=>{ setJumpPath('/dev-tools/chat-layout-preview'); handleNavigate(); }}>Chat 布局预览</Button>
            <Button variant="secondary" size="sm" onClick={()=>{ setJumpPath('/dev-tools/thinkbar-previews'); handleNavigate(); }}>思考栏样式预览</Button>
            <Button variant="secondary" size="sm" onClick={()=>{ setJumpPath('/dev-tools/dialog-test'); handleNavigate(); }}>对话框测试</Button>
            <Button variant="secondary" size="sm" onClick={()=>{ setJumpPath('/dev-tools/download-test'); handleNavigate(); }}>下载测试</Button>
          </div>
          {recents.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium">最近打开</h4>
              <div className="flex flex-wrap gap-2">
                {recents.map((r) => (
                  <Button
                    key={`${r.path}-${r.ts}`}
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      addRecentRoute(r.path, r.title);
                      setRecents(getRecentRoutes());
                      router.push(r.path);
                    }}
                  >
                    {r.title ?? r.path}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <strong>警告：</strong>这些工具仅用于开发和测试环境。在生产环境中使用前请确保已备份所有重要数据。
        </AlertDescription>
      </Alert>

      {/* 数据目录 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2"><FolderOpen className="h-5 w-5" /> 数据目录</CardTitle>
            <Button variant="outline" size="sm" onClick={handleOpenAppDataDir}>打开目录</Button>
          </div>
          <CardDescription>
            应用数据所在的系统目录（数据库、缓存等）
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground font-mono truncate">{appDataPath || '加载中…'}</div>
        </CardContent>
      </Card>

      {/* 示例数据管理器 */}
      <SampleDataManager />

      {/* 数据库修复工具 */}
      <DatabaseRepairTool />

      {/* 保留原高级工具（去掉其中的页面跳转块） */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Settings className="h-5 w-5" />
              <CardTitle>高级工具</CardTitle>
              <Badge variant="secondary">扩展功能</Badge>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvancedTools(!showAdvancedTools)}
            >
              {showAdvancedTools ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </div>
          <CardDescription>
            {showAdvancedTools ? '隐藏' : '显示'}额外的数据管理和锁管理工具
          </CardDescription>
        </CardHeader>

        {showAdvancedTools && (
          <CardContent>
            {/* 进度显示 */}
            {isAnyOperationRunning && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <RotateCcw className="h-4 w-4 animate-spin" />
                    <span>操作进行中...</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm text-muted-foreground mb-2">
                      <span>{currentStep}</span>
                      <span>{progress}%</span>
                    </div>
                    <Progress value={progress} className="w-full" />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 操作结果显示 */}
            {message && !isAnyOperationRunning && (
              <Alert className={`mb-6 ${message.startsWith('✅') ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {/* 锁管理工具 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <RotateCcw className="h-5 w-5" />
                    <span>锁管理</span>
                  </CardTitle>
                  <CardDescription>
                    检查和管理示例数据初始化锁
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <h4 className="font-medium">初始化锁状态</h4>
                    <p className="text-sm text-muted-foreground">
                      检查是否有卡住的初始化锁，并可以手动清除
                    </p>
                    
                    {lockStatus && (
                      <div className="bg-muted p-3 rounded-md text-sm">
                        <div><strong>锁状态:</strong> {lockStatus.hasLock ? '已锁定' : '未锁定'}</div>
                        {lockStatus.hasLock && (
                          <>
                            <div><strong>锁定时间:</strong> {lockStatus.lockTime}</div>
                            <div><strong>是否过期:</strong> {lockStatus.isExpired ? '是' : '否'}</div>
                          </>
                        )}
                      </div>
                    )}
                    
                    <div className="flex space-x-2">
                      <Button 
                        onClick={handleCheckLock} 
                        variant="outline"
                        disabled={isAnyOperationRunning}
                        size="sm"
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        检查锁状态
                      </Button>
                      <Button 
                        onClick={handleClearLock} 
                        variant="outline"
                        disabled={isAnyOperationRunning || !lockStatus?.hasLock}
                        size="sm"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        清除锁
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* 性能监控 */}
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Settings className="h-5 w-5" />
                    <span>事件驱动性能监控</span>
                  </CardTitle>
                  <CardDescription>
                    对比onEvent vs onToken的性能，验证架构优化效果
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <PerformanceReport />
                </CardContent>
              </Card>
              
              {/* 旧性能监控 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Settings className="h-5 w-5" />
                    <span>消息解析缓存</span>
                  </CardTitle>
                  <CardDescription>
                    实时监控消息更新和解析缓存性能
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <PerformanceMonitor />
                </CardContent>
              </Card>

              {/* 向量数据管理 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Database className="h-5 w-5" />
                    <span>向量数据管理</span>
                  </CardTitle>
                  <CardDescription>
                    管理和清理知识库向量嵌入数据
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <h4 className="font-medium">向量数据统计</h4>
                    <p className="text-sm text-muted-foreground">
                      查看向量数据使用情况，清理孤立的向量数据
                    </p>
                    
                    {vectorStats && (
                      <div className="bg-muted p-3 rounded-md text-sm space-y-1">
                        <div><strong>总向量数:</strong> {vectorStats.totalVectors}</div>
                        <div><strong>活跃向量:</strong> {vectorStats.activeVectors}</div>
                        <div><strong>已删除:</strong> {vectorStats.deletedVectors}</div>
                        <div className={vectorStats.orphanedVectors > 0 ? "text-orange-600 font-semibold" : ""}>
                          <strong>孤立向量:</strong> {vectorStats.orphanedVectors}
                        </div>
                      </div>
                    )}
                    
                    {vectorMessage && (
                      <div className="bg-muted p-2 rounded-md text-sm">
                        {vectorMessage}
                      </div>
                    )}
                    
                    <div className="flex space-x-2">
                      <Button 
                        onClick={handleGetVectorStats} 
                        variant="outline"
                        disabled={isLoadingVectorStats || isCleaningVectors}
                        size="sm"
                      >
                        {isLoadingVectorStats ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4 mr-2" />
                        )}
                        获取统计
                      </Button>
                      <Button 
                        onClick={handleCleanupVectors} 
                        variant="outline"
                        disabled={isLoadingVectorStats || isCleaningVectors || !vectorStats?.orphanedVectors}
                        size="sm"
                      >
                        {isCleaningVectors ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4 mr-2" />
                        )}
                        清理孤立向量
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* 知识库配置管理 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Settings className="h-5 w-5" />
                    <span>知识库配置管理</span>
                  </CardTitle>
                  <CardDescription>
                    查看和重置知识库配置，解决模型配置覆盖问题
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <h4 className="font-medium">配置信息</h4>
                    <p className="text-sm text-muted-foreground">
                      查看当前配置状态，重置为正确的默认配置
                    </p>
                    
                    {configInfo && (
                      <div className="bg-muted p-3 rounded-md text-sm space-y-2">
                        <div>
                          <strong>当前嵌入配置:</strong>
                          <div className="ml-4 mt-1 space-y-1">
                            <div>策略: {configInfo.current.embedding.strategy}</div>
                            <div>模型路径: {configInfo.current.embedding.modelPath}</div>
                            <div>模型名称: {configInfo.current.embedding.modelName}</div>
                            <div>维度: {configInfo.current.embedding.dimensions}</div>
                          </div>
                        </div>
                        <div>
                          <strong>默认嵌入配置:</strong>
                          <div className="ml-4 mt-1 space-y-1 text-green-600">
                            <div>策略: {configInfo.default.embedding.strategy}</div>
                            <div>模型路径: {configInfo.default.embedding.modelPath}</div>
                            <div>模型名称: {configInfo.default.embedding.modelName}</div>
                            <div>维度: {configInfo.default.embedding.dimensions}</div>
                          </div>
                        </div>
                        {/* 配置差异提示 */}
                        {(configInfo.current.embedding.modelPath !== configInfo.default.embedding.modelPath ||
                          configInfo.current.embedding.modelName !== configInfo.default.embedding.modelName ||
                          configInfo.current.embedding.dimensions !== configInfo.default.embedding.dimensions) && (
                          <div className="text-red-600 font-semibold">
                            ⚠️ 当前配置与默认配置不一致，可能导致维度不匹配问题
                          </div>
                        )}
                      </div>
                    )}
                    
                    {configMessage && (
                      <div className="bg-muted p-2 rounded-md text-sm whitespace-pre-line">
                        {configMessage}
                      </div>
                    )}
                    
                    <div className="flex space-x-2">
                      <Button 
                        onClick={handleShowKnowledgeBaseConfig} 
                        variant="outline"
                        disabled={isLoadingConfig || isResettingConfig}
                        size="sm"
                      >
                        {isLoadingConfig ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4 mr-2" />
                        )}
                        查看配置
                      </Button>
                      <Button 
                        onClick={handleResetKnowledgeBaseConfig} 
                        variant="outline"
                        disabled={isLoadingConfig || isResettingConfig}
                        size="sm"
                      >
                        {isResettingConfig ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <RotateCcw className="h-4 w-4 mr-2" />
                        )}
                        重置为默认值
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Google AI Provider 测试 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Settings className="h-5 w-5" />
                    <span>Google AI 测试</span>
                  </CardTitle>
                  <CardDescription>
                    测试Google AI Provider的流式响应功能
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <h4 className="font-medium">流式响应测试</h4>
                    <p className="text-sm text-muted-foreground">
                      测试Google AI Provider的连接和流式响应功能
                    </p>
                    
                    <Button 
                      onClick={handleTestGoogleAI} 
                      variant="outline"
                      disabled={isTestingGoogle}
                      className="w-full"
                    >
                      {isTestingGoogle ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Settings className="h-4 w-4 mr-2" />
                      )}
                      {isTestingGoogle ? '测试中...' : '测试Google AI Provider'}
                    </Button>
                    
                    {googleTestResult && (
                      <div className="bg-muted p-3 rounded-md text-sm max-h-32 overflow-y-auto">
                        <div className="whitespace-pre-wrap">{googleTestResult}</div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* 完全重置 */}
              <Card className="md:col-span-2 lg:col-span-3">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2 text-destructive">
                    <Trash2 className="h-5 w-5" />
                    <span>危险操作</span>
                  </CardTitle>
                  <CardDescription>
                    完全重置所有数据 - 不可逆操作
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Alert className="border-destructive/50 text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      <strong>警告：</strong>完全重置将删除所有数据库表、文件和配置。这个操作不可撤销
                    </AlertDescription>
                  </Alert>
                  
                  <div className="space-y-2">
                    <h4 className="font-medium text-destructive">完全重置所有数据</h4>
                    <p className="text-sm text-muted-foreground">
                      将删除：数据库中的所有表和数据、本地存储、文件系统中的所有文档、应用配置
                    </p>
                    <Button 
                      onClick={handleFullReset} 
                      variant="destructive"
                      disabled={isAnyOperationRunning}
                      className="w-full"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      完全重置所有数据
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
} 