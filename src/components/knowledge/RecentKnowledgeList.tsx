"use client";

import { Clock, Folder, Book, Code, Database } from 'lucide-react';
import { useState } from 'react';
import { cn } from "@/lib/utils";
import { ScrollArea } from '@/components/ui/scroll-area';

interface RecentKnowledgeItem {
  id: string;
  name: string;
  icon: string;
  iconBg: string;
  source: string;
  docCount: number;
  lastUsed?: string; // e.g., '今天使用'
}

interface RecentKnowledgeListProps {
  items: RecentKnowledgeItem[];
  onUseKnowledgeBase?: (id: string) => void;
}

// Helper to get Lucide icon component based on string name
const getIconComponent = (iconName: string) => {
  switch (iconName.toLowerCase()) {
    case 'folder': return Folder;
    case 'book': return Book;
    case 'code': return Code;
    default: return Database;
  }
};

export function RecentKnowledgeList({ items, onUseKnowledgeBase }: RecentKnowledgeListProps) {
  const [hover, setHover] = useState(false);
  const visibleList = hover ? items : items.slice(0, 1);

  const handleUse = (id: string) => {
    onUseKnowledgeBase ? onUseKnowledgeBase(id) : console.log('Use recent KB:', id);
  };

  return (
    <div
      className="group mt-8 fade-in"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <h3 className="font-medium text-sm text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
        <Clock className="h-4 w-4 text-purple-500" />
        最近使用的知识库
      </h3>

      {items.length === 0 ? (
        <div className="rounded-lg bg-slate-100 dark:bg-slate-800 p-3 text-center text-xs text-slate-500 dark:text-slate-400">
          暂无最近使用
        </div>
      ) : (
        <ScrollArea className={cn('rounded-lg border border-transparent transition-all', hover ? 'h-40' : 'h-14')}>
          <div className="divide-y divide-slate-200 dark:divide-slate-700">
            {visibleList.map(item => {
              const IconComponent = getIconComponent(item.icon);
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 px-2 py-2 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
                  onClick={() => handleUse(item.id)}
                >
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-700">
                    <IconComponent className="h-4 w-4 text-slate-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">{item.name}</p>
                    {hover && (
                      <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {item.docCount}个文档 • {item.source}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
} 