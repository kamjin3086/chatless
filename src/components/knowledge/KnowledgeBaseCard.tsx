import { BrainCircuit, FileText, Clock, MoreVertical, Edit, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ContextMenu } from '@/components/ui/context-menu';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator 
} from '@/components/ui/dropdown-menu';
import type { KnowledgeBase } from '@/lib/knowledgeService';
import { createKnowledgeMenuItems } from './knowledgeMenu';

interface KnowledgeBaseCardProps {
  kb: KnowledgeBase & { documentCount?: number };
  /** 点击卡片打开详情 */
  onClick?: (kb: KnowledgeBase & { documentCount?: number }) => void;
  /** 管理文档（跳转页面） */
  onManage?: (id: string) => void;
  onRename?: (kb: KnowledgeBase) => void;
  onEditDesc?: (kb: KnowledgeBase) => void;
  onDelete?: (kb: KnowledgeBase) => void;
}

export function KnowledgeBaseCard({ kb, onClick, onManage, onRename, onEditDesc, onDelete }: KnowledgeBaseCardProps) {
  const desc = (kb.description || '').replace(/(\\n|\\r|\\t)/g, ' ').replace(/(\r?\n|\r)/g, ' ').trim();

  const menuItems = createKnowledgeMenuItems(kb, { onRename, onEditDesc, onDelete });

  const handleCardClick = () => {
    onClick?.(kb);
  };

  const handleMenuClick = (e: React.MouseEvent, action?: () => void) => {
    e.stopPropagation();
    action?.();
  };

  return (
    <ContextMenu menuItems={menuItems}>
      <div className="relative group">
        <button
          type="button"
          onClick={handleCardClick}
          className={cn(
            "flex flex-col text-left w-full p-3 min-h-28 rounded-lg border transition-colors duration-150 glass-panel",
            "bg-white/60 dark:bg-slate-900/40",
            "border-slate-200/60 dark:border-slate-700/40",
            "hover:border-slate-300/80 dark:hover:border-slate-600/60",
            "focus:outline-none focus:ring-1 focus:ring-slate-300 dark:focus:ring-slate-600"
          )}
        >
          <div className="flex items-center gap-2.5 mb-1.5">
            <div className="w-8 h-8 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <BrainCircuit className="h-4 w-4 text-slate-500 dark:text-slate-400" />
            </div>
            <p className="truncate font-medium text-xs flex-1 pr-6 text-slate-700 dark:text-slate-200">{kb.name}</p>
          </div>
          <p className="line-clamp-2 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed flex-1">{desc || '暂无描述'}</p>

          <div className="mt-auto pt-2 flex items-center justify-between text-[10px] text-slate-400">
            <span className="flex items-center gap-1">
              <FileText className="h-2.5 w-2.5" />
              {kb.documentCount ?? 0} 文档
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              {new Date(kb.updatedAt).toLocaleDateString('zh-CN')}
            </span>
          </div>
        </button>

        {/* 三个点菜单 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="absolute top-2 right-2 w-6 h-6 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-32 text-xs">
            <DropdownMenuItem 
              onClick={(e) => handleMenuClick(e, () => onRename?.(kb))}
              className="flex items-center gap-2 cursor-pointer text-xs"
            >
              <Edit className="w-3 h-3" />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={(e) => handleMenuClick(e, () => onEditDesc?.(kb) ?? onRename?.(kb))}
              className="flex items-center gap-2 cursor-pointer text-xs"
            >
              <Edit className="w-3 h-3" />
              修改描述
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              onClick={(e) => handleMenuClick(e, () => onDelete?.(kb))}
              className="flex items-center gap-2 cursor-pointer text-xs text-red-500"
            >
              <Trash2 className="w-3 h-3" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </ContextMenu>
  );
}
