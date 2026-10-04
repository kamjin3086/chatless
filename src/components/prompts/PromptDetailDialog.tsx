"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Star, Edit, Trash2, Copy, Check, Clock, Tag } from 'lucide-react';
import { useState } from 'react';
import { toast } from '@/components/ui/sonner';
import type { PromptItem } from '@/types/prompt';

interface PromptDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: PromptItem | null;
  onApply?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onToggleFavorite?: () => void;
}

export function PromptDetailDialog({
  open,
  onOpenChange,
  prompt,
  onApply,
  onEdit,
  onDelete,
  onToggleFavorite,
}: PromptDetailDialogProps) {
  const [copied, setCopied] = useState(false);

  if (!prompt) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt.content);
      setCopied(true);
      toast.success('已复制到剪贴板');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('复制失败');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0">
        <DialogHeader className="p-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-sm font-medium text-slate-800 dark:text-slate-200">
              {prompt.name}
            </DialogTitle>
            <div className="flex items-center gap-1">
              <button
                onClick={onToggleFavorite}
                className={cn(
                  "w-7 h-7 rounded-md flex items-center justify-center transition-colors",
                  prompt.favorite 
                    ? "text-slate-600 dark:text-slate-300" 
                    : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                )}
              >
                <Star className={cn("h-3.5 w-3.5", prompt.favorite && "fill-current")} />
              </button>
              <button
                onClick={handleCopy}
                className="w-7 h-7 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 flex items-center justify-center"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </DialogHeader>

        <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* 描述 */}
          {prompt.description && (
            <p className="text-xs text-slate-500 dark:text-slate-400">{prompt.description}</p>
          )}

          {/* 内容预览 */}
          <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3">
            <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-700 dark:text-slate-300 font-mono max-h-64 overflow-y-auto">
              {prompt.content}
            </pre>
          </div>

          {/* 标签与快捷指令 */}
          <div className="flex flex-wrap gap-1.5">
            {prompt.shortcuts?.map((s) => (
              <span
                key={s}
                className="text-[10px] px-1.5 py-0.5 rounded-md border border-slate-200/70 bg-slate-100/70 text-slate-600 dark:border-slate-600/50 dark:bg-slate-800/40 dark:text-slate-300 font-mono"
              >
                /{s}
              </span>
            ))}
            {prompt.tags?.map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex items-center gap-0.5"
              >
                <Tag className="h-2 w-2" />
                {tag}
              </span>
            ))}
          </div>

          {/* 统计信息 */}
          <div className="flex items-center gap-4 text-[10px] text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
            <span className="flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              更新于 {new Date(prompt.updatedAt).toLocaleDateString()}
            </span>
            {prompt.stats?.uses && prompt.stats.uses > 0 && (
              <span>使用 {prompt.stats.uses} 次</span>
            )}
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
              onClick={() => { onEdit?.(); onOpenChange(false); }}
              className="h-7 px-3 text-xs text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-md flex items-center gap-1"
            >
              <Edit className="h-3 w-3" />
              编辑
            </button>
            <button
              onClick={() => { onApply?.(); onOpenChange(false); }}
              className="h-7 px-3 text-xs bg-slate-800 hover:bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white rounded-md transition-colors"
            >
              应用到对话
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
