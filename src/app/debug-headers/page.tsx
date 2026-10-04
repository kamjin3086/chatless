"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { debugFetch, extractHeadersFromResponse } from '@/lib/utils/debug-headers';

export default function DebugHeadersPage() {
  const [url, setUrl] = useState('http://localhost:11434/api/tags');
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const testConnection = async () => {
    setLoading(true);
    setResult('');
    
    try {
      console.log('🔍 开始测试连接...');
      
      // 使用调试fetch
      const response = await debugFetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      const headerInfo = extractHeadersFromResponse(response, url, 'GET');
      
      setResult(JSON.stringify({
        status: response.status,
        statusText: response.statusText,
        headers: headerInfo.responseHeaders,
        environment: headerInfo.environment,
        timestamp: headerInfo.timestamp
      }, null, 2));
      
    } catch (error) {
      console.error('❌ 测试失败:', error);
      setResult(`错误: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const testTauriFetch = async () => {
    setLoading(true);
    setResult('');
    
    try {
      console.log('🔍 开始测试 Tauri Fetch...');
      
      const { tauriFetch } = await import('@/lib/request');
      const response = await tauriFetch(url, {
        method: 'GET',
        rawResponse: true,
        browserHeaders: true,
        danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
        fallbackToBrowserOnError: true,
        verboseDebug: true,
        debugTag: 'ModelList',
      });
      
      const headerInfo = extractHeadersFromResponse(response, url, 'GET');
      
      setResult(JSON.stringify({
        status: response.status,
        statusText: response.statusText,
        headers: headerInfo.responseHeaders,
        environment: headerInfo.environment,
        timestamp: headerInfo.timestamp
      }, null, 2));
      
    } catch (error) {
      console.error('❌ Tauri Fetch 测试失败:', error);
      setResult(`Tauri Fetch 错误: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>HTTP 头部调试工具</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="输入要测试的URL"
              className="flex-1"
            />
            <Button onClick={testConnection} disabled={loading}>
              {loading ? '测试中...' : '测试原生Fetch'}
            </Button>
            <Button onClick={testTauriFetch} disabled={loading} variant="outline">
              {loading ? '测试中...' : '测试TauriFetch'}
            </Button>
          </div>
          
          {result && (
            <div className="mt-4">
              <h3 className="text-lg font-semibold mb-2">结果:</h3>
              <pre className="bg-slate-100 p-4 rounded-md text-sm overflow-auto max-h-96">
                {result}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>使用说明</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <p>1. 输入要测试的URL（默认是Ollama的tags接口）</p>
            <p>2. 点击"测试原生Fetch"使用浏览器原生fetch</p>
            <p>3. 点击"测试TauriFetch"使用Tauri的HTTP插件</p>
            <p>4. 查看控制台输出的详细头部信息</p>
            <p>5. 对比开发环境和生产环境的差异</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 