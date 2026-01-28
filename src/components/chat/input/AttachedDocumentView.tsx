"use client";

import React, { useState } from 'react';
import { FileText, X, Database, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getCurrentKnowledgeBaseConfig } from '@/lib/knowledgeBaseConfig';
import { estimateTokens } from '@/lib/utils/tokenBudget';
import { toast } from '@/components/ui/sonner';
import { KnowledgeService } from '@/lib/knowledgeService';

interface AttachedDocumentViewProps {
  document: {
    name: string;
    summary: string;
    fileSize: number;
  };
  onRemove: () => void;
  className?: string;
  onIndexed?: (knowledgeBaseId: string) => void;
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
};

export function AttachedDocumentView({ document, onRemove, className, onIndexed }: AttachedDocumentViewProps) {
  const cfg = getCurrentKnowledgeBaseConfig();
  const isBigFile = document.fileSize > cfg.documentProcessing.bigFileSizeMb * 1024 * 1024;
  const tokenEstimate = estimateTokens(document.summary || document.name);
  const isBigToken = tokenEstimate > cfg.documentProcessing.bigTokenThreshold;
  const showIndexHint = isBigFile || isBigToken;

  const [indexing, setIndexing] = useState(false);

  const handleQuickIndex = async () => {
    try {
      setIndexing(true);
      await KnowledgeService.initDb();
      const tempKbName = '临时收纳箱';
      const all = await KnowledgeService.getAllKnowledgeBases();
      let kb = all.find(k => k.name === tempKbName);
      if (!kb) {
        kb = await KnowledgeService.createKnowledgeBase(tempKbName, '用于临时索引与引用的知识库');
      }
      const { UnifiedFileService } = await import('@/lib/unifiedFileService');
      const base = (document.name || 'document').replace(/\.[^.]+$/, '');
      const previewName = `${base}.preview.txt`;
      const fakeBytes = new TextEncoder().encode(document.summary || document.name);
      const saved = await UnifiedFileService.saveFile(fakeBytes, previewName, 'chat', { knowledgeBaseId: kb.id });
      await KnowledgeService.addDocumentToKnowledgeBase(saved.id, kb.id, {
        onProgress: () => {},
        skipIfExists: true,
      });
      toast.success('已索引到知识库');
      onIndexed?.(kb.id);
    } catch (e) {
      toast.error('索引失败');
    } finally {
      setIndexing(false);
    }
  };

  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-2 rounded-lg",
      "bg-slate-50 dark:bg-slate-800/50",
      "border border-slate-200 dark:border-slate-700",
      className
    )}>
      {/* 图标 */}
      <FileText className="w-4 h-4 text-slate-400 shrink-0" />
      
      {/* 信息 */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-sm text-slate-700 dark:text-slate-200 truncate">
          {document.name}
        </span>
        <span className="text-xs text-slate-400 shrink-0">
          {formatFileSize(document.fileSize)}
        </span>
        </div>

      {/* 大文档提示 */}
      {showIndexHint && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void handleQuickIndex();
          }}
          disabled={indexing}
          className="shrink-0 px-2 py-1 rounded text-[11px] text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center gap-1"
          title="文档较大，建议索引到知识库"
        >
          {indexing ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Database className="w-3 h-3" />
          )}
          <span>索引</span>
        </button>
          )}

      {/* 移除按钮 */}
      <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
        className="shrink-0 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        title="移除"
        >
          <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
} 
