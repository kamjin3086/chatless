'use client';

import { useEffect, useState } from 'react';
import { getEnvironmentDetails, isDevelopment, canUseTauriAPI, shouldShowDevTools, performEnvironmentCheck, type EnvironmentDetection } from '../../lib/utils/environment';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Monitor, Globe, AlertCircle, CheckCircle } from 'lucide-react';

interface EnvironmentInfo {
  environment: 'development' | 'production';
  isTauriApp: boolean;
  canUseDevTools: boolean;
  details: EnvironmentDetection;
}

export function EnvironmentStatus() {
  const [envInfo, setEnvInfo] = useState<EnvironmentInfo | null>(null);

  useEffect(() => {
    // 客户端获取环境信息
    const loadEnvironmentInfo = async () => {
      const isDevEnv = isDevelopment();
      const canUseDevTools = shouldShowDevTools();
      
      // 使用异步检测获取真实的环境信息
      const details = await performEnvironmentCheck();
      
      setEnvInfo({
        environment: isDevEnv ? 'development' : 'production',
        isTauriApp: details.isTauri,
        canUseDevTools: isDevEnv && details.isTauri,
        details
      });
    };
    
    loadEnvironmentInfo();
  }, []);

  if (!envInfo) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            环境检测中...
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">正在检测运行环境...</p>
        </CardContent>
      </Card>
    );
  }

  const PlatformIcon = envInfo.isTauriApp ? Monitor : Globe;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlatformIcon className="h-4 w-4" />
          运行环境状态
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground">环境类型</label>
            <div className="mt-1">
              <Badge variant={envInfo.environment === 'development' ? 'default' : 'secondary'}>
                {envInfo.environment === 'development' ? '开发环境' : '生产环境'}
              </Badge>
            </div>
          </div>
          
          <div>
            <label className="text-sm font-medium text-muted-foreground">应用状态</label>
            <div className="mt-1">
              <Badge variant={envInfo.isTauriApp ? 'default' : 'outline'}>
                {envInfo.isTauriApp ? 'Tauri应用' : '未识别'}
              </Badge>
            </div>
          </div>
        </div>
        
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {envInfo.isTauriApp ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-500" />
            )}
            <span className="text-sm">
              Tauri环境: {envInfo.isTauriApp ? '已识别' : '未识别'}
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            {envInfo.canUseDevTools ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <AlertCircle className="h-4 w-4 text-orange-500" />
            )}
            <span className="text-sm">
              开发工具: {envInfo.canUseDevTools ? '可用' : '不可用'}
            </span>
          </div>
        </div>
        
        {!envInfo.isTauriApp && (
          <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
            <p className="text-sm text-yellow-700 dark:text-yellow-300">
              <strong>提示：</strong>开发工具需要在Tauri应用的开发环境中运行。请使用 <code>pnpm tauri dev</code> 启动应用。
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
} 