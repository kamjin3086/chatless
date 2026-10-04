"use client";

import { Button } from "@/components/ui/button";
import { downloadService } from "@/lib/utils/downloadService";
import { toast } from "@/components/ui/sonner";
import { useState, useEffect } from "react";
import { detectTauriEnvironment, performEnvironmentCheck, logEnvironmentInfo } from "@/lib/utils/environment";

export default function DownloadTestPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [environment, setEnvironment] = useState<string>('检测中...');

  // 检测运行环境
  useEffect(() => {
    const detectEnvironment = async () => {
      try {
        const isTauri = await detectTauriEnvironment();
        setEnvironment(isTauri ? 'Tauri环境' : '浏览器环境');
      } catch (error) {
        console.error('环境检测失败:', error);
        setEnvironment('检测失败');
      }
    };
    
    detectEnvironment();
  }, []);

  const testEnvironmentDetection = async () => {
    try {
      console.log('[Test] 开始详细环境检测测试');
      
      // 执行完整的环境检查
      const envDetails = await performEnvironmentCheck();
      logEnvironmentInfo(envDetails);
      
      if (envDetails.isTauri) {
        toast.success(`检测到Tauri环境，API测试成功`);
      } else {
        toast.info('当前在浏览器环境中运行');
      }
    } catch (error) {
      console.error('[Test] 环境检测失败:', error);
      toast.error('环境检测失败');
    }
  };

  const testTextDownload = async () => {
    setIsLoading(true);
    try {
      console.log('[Test] 开始测试文本文件下载');
      
      const content = `这是一个测试文本文件
创建时间: ${new Date().toLocaleString()}
内容: 测试下载服务是否正常工作

功能测试:
1. 浏览器下载
2. Tauri保存对话框
3. 文件名处理
4. 错误处理

如果看到这个文件，说明下载服务工作正常！`;
      
      console.log('[Test] 调用下载服务...');
      const success = await downloadService.downloadText('test-download.txt', content);
      console.log('[Test] 下载服务返回结果:', success);
      
      if (success) {
        toast.success('文本文件下载成功');
      } else {
        toast.error('文本文件下载失败');
      }
    } catch (error) {
      console.error('[Test] 下载测试失败:', error);
      toast.error('下载测试失败');
    } finally {
      setIsLoading(false);
    }
  };

  const testJsonDownload = async () => {
    setIsLoading(true);
    try {
      const report = {
        test: true,
        timestamp: new Date().toISOString(),
        message: "这是一个测试JSON文件",
        features: [
          "浏览器下载",
          "Tauri保存对话框",
          "JSON格式化",
          "错误处理"
        ]
      };
      
      const success = await downloadService.downloadJson('test-data.json', report);
      
      if (success) {
        toast.success('JSON文件下载成功');
      } else {
        toast.error('JSON文件下载失败');
      }
    } catch (error) {
      console.error('下载测试失败:', error);
      toast.error('下载测试失败');
    } finally {
      setIsLoading(false);
    }
  };

  const testMarkdownDownload = async () => {
    setIsLoading(true);
    try {
      const content = `# 下载服务测试

## 功能验证

这是一个测试Markdown文件，用于验证下载服务是否正常工作。

### 测试项目

- [x] 浏览器下载
- [x] Tauri保存对话框
- [x] 文件名处理
- [x] 错误处理
- [x] 不同文件类型支持

### 时间戳

创建时间: ${new Date().toLocaleString()}

### 代码示例

\`\`\`javascript
// 使用下载服务
const success = await downloadService.downloadMarkdown('test.md', content);
if (success) {
  console.log('下载成功');
}
\`\`\`

如果看到这个文件，说明下载服务工作正常！
`;
      
      const success = await downloadService.downloadMarkdown('test-markdown.md', content);
      
      if (success) {
        toast.success('Markdown文件下载成功');
      } else {
        toast.error('Markdown文件下载失败');
      }
    } catch (error) {
      console.error('下载测试失败:', error);
      toast.error('下载测试失败');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">下载服务测试</h1>
      
      <div className="space-y-4">
        <div className="p-4 border rounded-lg">
          <h2 className="text-lg font-semibold mb-2">环境信息</h2>
          <p className="text-sm text-slate-600 mb-4">
            当前运行环境: <span className="font-medium">{environment}</span>
          </p>
          
          <Button 
            onClick={testEnvironmentDetection}
            variant="outline"
            size="sm"
          >
            重新检测环境
          </Button>
        </div>

        <div className="p-4 border rounded-lg">
          <h2 className="text-lg font-semibold mb-2">测试说明</h2>
          <p className="text-sm text-slate-600 mb-4">
            这个页面用于测试统一的下载服务。下载服务会优先尝试浏览器下载，
            如果失败则回退到Tauri的保存对话框。
          </p>
          
          <div className="space-y-2">
            <p className="text-sm">
              <strong>浏览器环境:</strong> 使用浏览器的下载功能
            </p>
            <p className="text-sm">
              <strong>Tauri环境:</strong> 使用系统保存对话框
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <Button 
            onClick={testTextDownload} 
            disabled={isLoading}
            className="w-full"
          >
            {isLoading ? '测试中...' : '测试文本文件下载'}
          </Button>
          
          <Button 
            onClick={testJsonDownload} 
            disabled={isLoading}
            variant="outline"
            className="w-full"
          >
            {isLoading ? '测试中...' : '测试JSON文件下载'}
          </Button>
          
          <Button 
            onClick={testMarkdownDownload} 
            disabled={isLoading}
            variant="outline"
            className="w-full"
          >
            {isLoading ? '测试中...' : '测试Markdown文件下载'}
          </Button>
        </div>

        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="font-semibold text-blue-800 mb-2">测试步骤</h3>
          <ol className="text-sm text-blue-700 space-y-1">
            <li>1. 点击任意测试按钮</li>
            <li>2. 观察是否触发下载或保存对话框</li>
            <li>3. 检查下载的文件内容是否正确</li>
            <li>4. 查看控制台是否有错误信息</li>
          </ol>
        </div>

        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <h3 className="font-semibold text-yellow-800 mb-2">调试信息</h3>
          <p className="text-sm text-yellow-700">
            请打开浏览器的开发者工具（F12），查看控制台输出。
            所有下载服务的操作都会在控制台中显示详细的日志信息。
          </p>
        </div>
      </div>
    </div>
  );
} 