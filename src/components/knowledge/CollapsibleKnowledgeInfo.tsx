"use client";

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Calendar, FileText, Clock, Database } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { KnowledgeBase } from '@/lib/database/repositories/KnowledgeBaseRepository';

interface CollapsibleKnowledgeInfoProps {
  knowledgeBase: KnowledgeBase;
  documentsCount: number;
}

export function CollapsibleKnowledgeInfo({ knowledgeBase, documentsCount }: CollapsibleKnowledgeInfoProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const rawDescription = knowledgeBase.description || '';
  // 将文本中的 "\n" 字符串替换为真实换行，供显示使用
  const formattedDescription = rawDescription.replace(/\\n/g, "\n");

  const isLongDescription = formattedDescription.length > 120;
  const shouldShowCollapse = isLongDescription;
  
  // 获取截断的描述文本
  const truncatedDescription = isLongDescription 
    ? formattedDescription.substring(0, 120).replace(/(\r?\n|\r)/g, ' ') + '...' 
    : formattedDescription;

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <Card className="overflow-hidden rounded-lg border border-slate-200/70 dark:border-slate-700/60 bg-white dark:bg-slate-900/60 shadow-sm hover:shadow-md transition-all duration-200">
      <div className="p-5">
        {/* 描述内容 */}
        <div className="mb-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary/10 dark:bg-primary/20 mt-1">
              <Database className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                {shouldShowCollapse && !isExpanded ? (
                  <span>{truncatedDescription}</span>
                ) : (
                  <span>{formattedDescription || "暂无描述"}</span>
                )}
              </div>
              
              {shouldShowCollapse && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleExpanded}
                  className="mt-2 p-0 h-auto text-primary hover:text-primary/80 font-medium text-sm"
                >
                  {isExpanded ? (
                    <>
                      <ChevronUp className="h-4 w-4 mr-1" />
                      收起
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4 mr-1" />
                      查看更多
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* 统计信息 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5 pt-4 border-t border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <Calendar className="h-4 w-4 text-slate-500" />
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                创建时间
              </div>
              <div className="text-[13px] font-medium text-slate-900 dark:text-slate-100">
                {new Date(knowledgeBase.createdAt).toLocaleDateString('zh-CN', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric'
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Clock className="h-4 w-4 text-slate-500" />
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                更新时间
              </div>
              <div className="text-[13px] font-medium text-slate-900 dark:text-slate-100">
                {new Date(knowledgeBase.updatedAt).toLocaleDateString('zh-CN', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric'
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <FileText className="h-4 w-4 text-slate-500" />
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                文档数量
              </div>
              <div className="text-[13px] font-medium text-slate-900 dark:text-slate-100">
                {documentsCount} 个文档
              </div>
            </div>
          </div>
        </div>

        {/* 折叠状态下的额外信息 */}
        <div 
          className={cn(
            "overflow-hidden transition-all duration-300 ease-in-out",
            isExpanded ? "max-h-96 opacity-100 mt-4" : "max-h-0 opacity-0"
          )}
        >
          <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium text-slate-700 dark:text-slate-300">知识库ID：</span>
                <span className="text-slate-600 dark:text-slate-400 font-mono text-xs">{knowledgeBase.id}</span>
              </div>
              <div>
                <span className="font-medium text-slate-700 dark:text-slate-300">加密状态：</span>
                <span className={cn(
                  "ml-2 px-2 py-1 rounded-full text-xs font-medium",
                  knowledgeBase.isEncrypted 
                    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" 
                    : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                )}>
                  {knowledgeBase.isEncrypted ? "已加密" : "未加密"}
                </span>
              </div>
              <div>
                <span className="font-medium text-slate-700 dark:text-slate-300">图标：</span>
                <span className="text-slate-600 dark:text-slate-400">{knowledgeBase.icon}</span>
              </div>
              <div>
                <span className="font-medium text-slate-700 dark:text-slate-300">完整更新时间：</span>
                <span className="text-slate-600 dark:text-slate-400">
                  {new Date(knowledgeBase.updatedAt).toLocaleString('zh-CN')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
} 