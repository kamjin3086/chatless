"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Smartphone, Monitor, RefreshCw, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { 
  performEnvironmentCheck, 
  logEnvironmentInfo,
  type EnvironmentDetection 
} from "../../lib/utils/environment";

export function EnvironmentDebug() {
  const [envDetails, setEnvDetails] = useState<EnvironmentDetection | null>(null);
  const [loading, setLoading] = useState(true);

  const checkEnvironment = async () => {
    setLoading(true);
    try {
      const details = await performEnvironmentCheck();
      setEnvDetails(details);
      logEnvironmentInfo(details);
    } catch (error) {
      console.error('Environment check failed:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkEnvironment();
  }, []);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            检测环境中...
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (!envDetails) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-600">
            <XCircle className="w-4 h-4" />
            环境检测失败
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  const getEnvironmentBadge = () => {
    if (envDetails.isTauri) {
      return (
        <Badge variant="default" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
          <Monitor className="w-3 h-3 mr-1" />
          Tauri 应用
        </Badge>
      );
    } else {
      return (
        <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
          <Smartphone className="w-3 h-3 mr-1" />
          浏览器环境
        </Badge>
      );
    }
  };

  const getTestResultIcon = () => {
    if (!envDetails.testResult) return null;
    
    if (envDetails.testResult.success) {
      return <CheckCircle className="w-4 h-4 text-green-600" />;
    } else {
      return <XCircle className="w-4 h-4 text-red-600" />;
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">环境调试信息</CardTitle>
              <CardDescription>
                当前运行环境的详细检测信息
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={checkEnvironment}>
              <RefreshCw className="w-3 h-3 mr-1" />
              重新检测
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 环境类型 */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">环境类型:</span>
            {getEnvironmentBadge()}
          </div>

          {/* 基础信息 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                基础检测
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span>Window 对象:</span>
                  <Badge variant={envDetails.hasWindow ? "default" : "destructive"} className="text-xs">
                    {envDetails.hasWindow ? "存在" : "不存在"}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span>__TAURI__ 全局:</span>
                  <Badge variant={envDetails.hasTauriGlobal ? "default" : "secondary"} className="text-xs">
                    {envDetails.hasTauriGlobal ? "存在" : "不存在"}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span>__TAURI_INTERNALS__:</span>
                  <Badge variant={envDetails.hasTauriInternals ? "default" : "secondary"} className="text-xs">
                    {envDetails.hasTauriInternals ? "存在" : "不存在"}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span>可调用 Invoke:</span>
                  <Badge variant={envDetails.canCallInvoke ? "default" : "secondary"} className="text-xs">
                    {envDetails.canCallInvoke ? "是" : "否"}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                系统信息
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span>Node 环境:</span>
                  <Badge variant="outline" className="text-xs">
                    {envDetails.nodeEnv}
                  </Badge>
                </div>
                <div className="flex flex-col gap-1">
                  <span>User Agent:</span>
                  <div className="text-xs text-slate-600 dark:text-slate-400 break-all bg-slate-50 dark:bg-slate-800 p-2 rounded-md">
                    {envDetails.userAgent}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* API 测试结果 */}
          {envDetails.testResult && (
            <div className="border-t pt-4">
              <div className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                API 测试结果
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-lg space-y-2">
                <div className="flex items-center gap-2">
                  {getTestResultIcon()}
                  <span className="text-sm font-medium">
                    {envDetails.testResult.method} 方法测试
                  </span>
                  <Badge variant={envDetails.testResult.success ? "default" : "destructive"} className="text-xs">
                    {envDetails.testResult.success ? "成功" : "失败"}
                  </Badge>
                </div>
                
                {envDetails.testResult.success && envDetails.testResult.result && (
                  <div className="text-xs">
                    <span className="text-slate-600 dark:text-slate-400">返回结果:</span>
                    <div className="bg-green-50 dark:bg-green-900/20 p-2 rounded-md mt-1 font-mono">
                      {JSON.stringify(envDetails.testResult.result, null, 2)}
                    </div>
                  </div>
                )}
                
                {!envDetails.testResult.success && envDetails.testResult.error && (
                  <div className="text-xs">
                    <span className="text-slate-600 dark:text-slate-400">错误信息:</span>
                    <div className="bg-red-50 dark:bg-red-900/20 p-2 rounded-md mt-1 text-red-700 dark:text-red-300 font-mono">
                      {envDetails.testResult.error}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 结论和建议 */}
          <div className="border-t pt-4">
            <div className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              检测结论
            </div>
            {envDetails.isTauri ? (
              <div className="flex items-start gap-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
                <div className="text-sm">
                  <div className="font-medium text-green-800 dark:text-green-200">
                    正在 Tauri 应用中运行
                  </div>
                  <div className="text-green-700 dark:text-green-300 text-xs mt-1">
                    所有 Tauri API 功能都可以正常使用
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5" />
                <div className="text-sm">
                  <div className="font-medium text-yellow-800 dark:text-yellow-200">
                    ⚠️ 在浏览器中运行
                  </div>
                  <div className="text-yellow-700 dark:text-yellow-300 text-xs mt-1">
                    Tauri API 不可用，请在 Tauri 应用中打开以获得完整功能
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 