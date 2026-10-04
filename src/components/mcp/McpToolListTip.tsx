"use client";

import React from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface McpToolListTipProps {
  toolCount: number;
  tools: Array<{ name: string; description?: string } | string>;
  className?: string;
  children: React.ReactNode; // 触发器
}

/**
 * McpToolListTip
 * 统一的“工具列表 Tip”组件。
 * - 可复用在设置页、聊天侧边的 MCP 快捷开关等位置
 * - 工具数据由调用方提供，组件仅负责展示
 */
export function McpToolListTip({ toolCount, tools, className, children }: McpToolListTipProps) {
  const list = (tools || []).map((t: any) =>
    typeof t === 'string' ? { name: t } : { name: String(t?.name || ''), description: t?.description }
  ).filter(it => it.name);

  return (
    <TooltipProvider>
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className={`max-w-md p-3 z-[9999] ${className || ''}`}>
        <div className="space-y-2">
          <div className="font-medium text-sm text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-700 pb-1">
            可用工具列表 ({toolCount})
          </div>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {list.map((tool, index) => (
              <div key={`${tool.name}-${index}`} className="text-xs p-1.5 rounded-md bg-slate-50 dark:bg-slate-800">
                <div className="font-mono text-blue-600 font-medium break-all">{tool.name}</div>
                {tool.description && (
                  <div className="text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed break-words">
                    {tool.description}
                  </div>
                )}
              </div>
            ))}
            {list.length === 0 && (
              <div className="text-xs text-slate-500">无可用工具</div>
            )}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
    </TooltipProvider>
  );
}

export default McpToolListTip;


