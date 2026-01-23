"use client";

import React from 'react';
import { Database, X, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KnowledgeBase } from '@/lib/knowledgeService';
import { useRouter } from 'next/navigation';

interface SelectedKnowledgeBaseViewProps {
  knowledgeBase: KnowledgeBase;
  onRemove: () => void;
  className?: string;
}

export function SelectedKnowledgeBaseView({ knowledgeBase, onRemove, className }: SelectedKnowledgeBaseViewProps) {
  const router = useRouter();

  const handleGoToKnowledgeBase = () => {
    router.push(`/knowledge/detail?id=${knowledgeBase.id}`);
  };

  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-2 rounded-lg",
      "bg-slate-50 dark:bg-slate-800/50",
      "border border-slate-200 dark:border-slate-700",
      className
    )}>
      {/* 图标 */}
      <Database className="w-4 h-4 text-slate-400 shrink-0" />
        
      {/* 名称 */}
      <span className="flex-1 min-w-0 text-sm text-slate-700 dark:text-slate-200 truncate">
        {knowledgeBase.name}
      </span>

      {/* 管理按钮 */}
            <button
        onClick={handleGoToKnowledgeBase}
        className="shrink-0 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        title="管理知识库"
            >
        <ExternalLink className="w-3.5 h-3.5" />
            </button>

      {/* 移除按钮 */}
      <button
            onClick={onRemove}
        className="shrink-0 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        title="移除"
          >
            <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
} 
