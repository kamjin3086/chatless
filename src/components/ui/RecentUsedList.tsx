'use client';

import { useState, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Clock, FileText, FileJson, FileCode, Database, Folder, Book, MessageSquare } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

/**
 * 统一的"最近使用"列表组件
 * 适用于：资源引用、知识库、提示词等场景
 */

export interface RecentItem {
  id: string;
  name: string;
  /** 图标类型：file/json/code/database/folder/book/prompt 或自定义 */
  iconType?: string;
  /** 副标题/描述信息 */
  subtitle?: string;
  /** 时间信息 */
  time?: string;
  /** 自定义图标（优先级高于 iconType） */
  customIcon?: ReactNode;
}

interface RecentUsedListProps {
  /** 列表标题 */
  title?: string;
  /** 数据项 */
  items: RecentItem[];
  /** 点击项目回调 */
  onItemClick?: (id: string) => void;
  /** 空状态文本 */
  emptyText?: string;
  /** 最大展开高度 */
  maxHeight?: number;
  /** 自定义类名 */
  className?: string;
}

// 根据类型获取图标
const getIcon = (iconType?: string): ReactNode => {
  const type = (iconType || 'file').toLowerCase();
  const iconClass = "h-3.5 w-3.5 text-slate-400";
  
  switch (type) {
    case 'json':
      return <FileJson className={iconClass} />;
    case 'code':
    case 'md':
    case 'markdown':
    case 'txt':
      return <FileCode className={iconClass} />;
    case 'database':
      return <Database className={iconClass} />;
    case 'folder':
      return <Folder className={iconClass} />;
    case 'book':
      return <Book className={iconClass} />;
    case 'prompt':
      return <MessageSquare className={iconClass} />;
    default:
      return <FileText className={iconClass} />;
  }
};

export function RecentUsedList({
  title = '最近使用',
  items,
  onItemClick,
  emptyText = '暂无',
  maxHeight = 128,
  className,
}: RecentUsedListProps) {
  const [hover, setHover] = useState(false);
  const visibleItems = hover ? items : items.slice(0, 1);

  return (
    <div
      className={cn("group", className)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <h3 className="text-xs text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1.5">
        <Clock className="h-3 w-3" />
        {title}
      </h3>

      {items.length === 0 ? (
        <div className="text-[11px] text-slate-400 py-1">{emptyText}</div>
      ) : (
        <ScrollArea 
          className={cn(
            'transition-all duration-150',
            hover ? `h-[${maxHeight}px]` : 'h-8'
          )}
          style={{ height: hover ? maxHeight : 32 }}
        >
          <div className="space-y-0.5">
            {visibleItems.map(item => (
              <div
                key={item.id}
                className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                onClick={() => onItemClick?.(item.id)}
              >
                <div className="flex h-5 w-5 items-center justify-center rounded bg-slate-100 dark:bg-slate-800 flex-shrink-0">
                  {item.customIcon || getIcon(item.iconType)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] text-slate-600 dark:text-slate-300">{item.name}</p>
                  {hover && (item.subtitle || item.time) && (
                    <p className="truncate text-[10px] text-slate-400">
                      {item.subtitle}{item.subtitle && item.time ? ' · ' : ''}{item.time}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
