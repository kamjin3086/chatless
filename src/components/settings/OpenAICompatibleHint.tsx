"use client";
import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X, Lightbulb, ExternalLink } from 'lucide-react';

interface OpenAICompatibleHintProps {
  onDismiss?: () => void;
}

export function OpenAICompatibleHint({ onDismiss }: OpenAICompatibleHintProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <Card className="mb-6 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Lightbulb className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-blue-900 dark:text-blue-100 mb-2">
              快速添加 OpenAI 兼容服务
            </div>
            <div className="text-sm text-blue-800 dark:text-blue-200 space-y-2">
              <div>
                现在您可以通过 <span className="font-medium">"+ OpenAI兼容"</span> 按钮快速添加第三方API服务：
              </div>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>302.AI、OpenRouter、Groq 等热门服务</li>
                <li>支持任何遵循 OpenAI API 标准的服务</li>
                <li>自动配置最佳兼容性设置</li>
              </ul>
              <div className="flex items-center gap-1 text-xs">
                <span>不知道选择哪个服务？</span>
                <a 
                  href="https://github.com/chatless/chatless/wiki/supported-providers" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                >
                  查看推荐列表 <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            className="text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/20 p-1 h-auto"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}