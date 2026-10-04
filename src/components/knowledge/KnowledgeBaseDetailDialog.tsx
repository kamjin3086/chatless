"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BrainCircuit, FileText, Clock, Edit, Trash2, FolderOpen } from 'lucide-react';
import type { KnowledgeBase } from '@/lib/knowledgeService';

interface KnowledgeBaseDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kb: (KnowledgeBase & { documentCount?: number }) | null;
  onManage?: () => void;
  onRename?: () => void;
  onEditDesc?: () => void;
  onDelete?: () => void;
}

export function KnowledgeBaseDetailDialog({
  open,
  onOpenChange,
  kb,
  onManage,
  onRename,
  onEditDesc,
  onDelete,
}: KnowledgeBaseDetailDialogProps) {
  if (!kb) return null;

  const desc = (kb.description || '').replace(/(\\n|\\r|\\t)/g, ' ').replace(/(\r?\n|\r)/g, ' ').trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0">
        <DialogHeader className="p-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <BrainCircuit className="h-4 w-4 text-slate-500 dark:text-slate-400" />
            </div>
            <DialogTitle className="text-sm font-medium text-slate-800 dark:text-slate-200">
              {kb.name}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="p-4 space-y-4">
          {/* 描述 */}
          <div>
            <div className="text-[10px] text-slate-400 mb-1">描述</div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {desc || '暂无描述'}
            </p>
          </div>

          {/* 统计信息 */}
          <div className="flex items-center gap-6 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              <span>{kb.documentCount ?? 0} 个文档</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              <span>更新于 {new Date(kb.updatedAt).toLocaleDateString('zh-CN')}</span>
            </div>
          </div>

          {/* 详细信息 */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">创建时间</span>
              <span className="text-slate-600 dark:text-slate-300">
                {new Date(kb.createdAt).toLocaleString('zh-CN')}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">ID</span>
              <span className="text-slate-500 font-mono text-[10px]">{kb.id.slice(0, 8)}...</span>
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="p-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <button
            onClick={() => { onDelete?.(); onOpenChange(false); }}
            className="h-7 px-2 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md flex items-center gap-1"
          >
            <Trash2 className="h-3 w-3" />
            删除
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { onRename?.(); onOpenChange(false); }}
              className="h-7 px-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-md flex items-center gap-1"
            >
              <Edit className="h-3 w-3" />
              重命名
            </button>
            <button
              onClick={() => { onManage?.(); onOpenChange(false); }}
              className="h-7 px-3 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded-md flex items-center gap-1"
            >
              <FolderOpen className="h-3 w-3" />
              管理文档
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
