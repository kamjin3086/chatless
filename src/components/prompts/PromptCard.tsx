'use client';

import { Star, Edit, MoreVertical, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { cn } from "@/lib/utils";

export interface Prompt {
  id: string;
  title: string;
  description: string;
  content: string;
  tags: string[];
  shortcuts?: string[];
  usageCount: number;
  lastUpdated: string;
  isFavorite: boolean;
}

interface PromptCardProps extends Prompt {
  onToggleFavorite?: (id: string) => void;
  onApply?: (id: string) => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export function PromptCard({
  id,
  title,
  description,
  content,
  tags,
  shortcuts = [],
  usageCount,
  lastUpdated,
  isFavorite,
  onToggleFavorite = () => {},
  onApply = () => {},
  onEdit = () => {},
  onDelete = () => {},
}: PromptCardProps) {

  return (
    <div className={cn(
      "group flex flex-col p-3 rounded-lg border transition-colors duration-150",
      "bg-white/80 dark:bg-slate-900/60",
      "border-slate-200/60 dark:border-slate-700/40",
      "hover:border-slate-300/80 dark:hover:border-slate-600/60"
    )}>
      {/* 头部 */}
      <div className="flex items-center justify-between mb-1.5">
        <h3 className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate pr-2" title={title}>
          {title}
        </h3>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onApply(id)}
            className="h-6 px-2 text-[10px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 rounded transition-colors"
          >
            应用
          </button>
          <button 
            className={cn(
              "w-6 h-6 rounded flex items-center justify-center transition-colors",
              isFavorite 
                ? "text-amber-500" 
                : "text-slate-400 hover:text-amber-500"
            )} 
            onClick={() => onToggleFavorite(id)}
          >
            <Star className={cn("h-3 w-3", isFavorite && "fill-current")} />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-6 h-6 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 flex items-center justify-center transition-colors">
                <MoreVertical className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-28 text-xs">
              <DropdownMenuItem onClick={() => onEdit(id)} className="text-xs">
                <Edit className="h-3 w-3 mr-2" /> 编辑
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-xs text-red-500" onClick={() => onDelete(id)}>
                <Trash2 className="h-3 w-3 mr-2" /> 删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 描述 */}
      {description && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mb-1.5">{description}</p>
      )}

      {/* 内容预览 */}
      <div className="rounded bg-slate-50/80 dark:bg-slate-800/40 px-2 py-1.5 mb-2 flex-1">
        <pre className="whitespace-pre-wrap break-words text-[10px] leading-relaxed text-slate-600 dark:text-slate-300 line-clamp-3 font-mono">
          {content}
        </pre>
      </div>

      {/* 底部：标签和统计 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1 min-w-0 flex-1">
          {shortcuts && shortcuts.length > 0 && shortcuts.slice(0, 1).map((s) => (
            <span
              key={s}
              className="text-[10px] px-1 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 font-mono"
            >
              /{s}
            </span>
          ))}
          {tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
            >
              {tag}
            </span>
          ))}
          {tags.length > 2 && (
            <span className="text-[10px] text-slate-400">+{tags.length - 2}</span>
          )}
        </div>
        <div className="text-[10px] text-slate-400 whitespace-nowrap">
          {usageCount > 0 && <span>{usageCount}次 · </span>}
          {lastUpdated}
        </div>
      </div>
    </div>
  );
}
