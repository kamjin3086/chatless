"use client";

import { Folder, Book, Code, Lock, Database } from 'lucide-react';
import { cn } from "@/lib/utils";

interface KnowledgeCardProps {
  id: string;
  name: string;
  icon: string; // e.g., 'folder', 'book', 'code'
  iconBg?: string; // Gradient class like 'from-blue-400 to-blue-600'
  source: string;
  docCount: number;
  description: string;
  lastUpdated: string;
  isEncrypted?: boolean;
  onView: (id: string) => void;
  onUse: (id: string) => void;
}

// Helper to get Lucide icon component based on string name
const getIconComponent = (iconName: string) => {
  switch (iconName.toLowerCase()) {
    case 'folder': return Folder;
    case 'book': return Book;
    case 'code': return Code;
    default: return Database; // Fallback icon
  }
};

export function KnowledgeCard({
  id,
  name,
  icon,
  iconBg = 'from-slate-400 to-slate-600',
  source,
  docCount,
  description,
  lastUpdated,
  isEncrypted = false,
  onView,
  onUse,
}: KnowledgeCardProps) {
  const IconComponent = getIconComponent(icon);

  return (
    <div className="knowledge-card bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden fade-in flex flex-col h-full">
      <div className="flex p-4 flex-grow">
        <div className={cn(
          "icon-container w-12 h-12 rounded-lg text-white flex items-center justify-center text-xl mr-4 shadow-md flex-shrink-0",
          `bg-gradient-to-br ${iconBg} dark:from-slate-600 dark:to-slate-700` 
        )}>
          <IconComponent className="w-6 h-6" />
        </div>
        <div className="flex-1 flex flex-col min-w-0"> 
          <h3 className="font-semibold text-lg mb-2 text-slate-800 dark:text-slate-200 truncate">{name}</h3>
          <div className="flex items-center gap-3 text-sm mb-3 flex-wrap">
            <span className="tag px-2.5 py-1 bg-gradient-to-r from-slate-100 to-slate-200 dark:from-slate-100 dark:to-slate-200 rounded-full text-slate-700 dark:text-slate-300">
              {source}
            </span>
            {isEncrypted && (
              <span className="tag px-2.5 py-1 bg-gradient-to-r from-red-100 to-red-200 dark:from-red-900 dark:to-red-800 rounded-full text-red-700 dark:text-red-300 flex items-center gap-1">
                <Lock className="w-3 h-3" />
                加密
              </span>
            )}
            <span className="text-slate-500 dark:text-slate-400">{docCount}个文档</span>
          </div>
          <p className="text-slate-600 dark:text-slate-400 text-sm mb-4 line-clamp-2 flex-grow">
            {description}
          </p>
          <div className="text-sm text-slate-500 dark:text-slate-400 mt-auto pt-2">
            最近更新: {lastUpdated}
          </div>
        </div>
      </div>
      {/* Footer with Actions */}
      <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex justify-end gap-2">
        <button 
          className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors duration-200 btn-click-effect"
          onClick={() => onView(id)}
        >
          查看
        </button>
        <button 
          className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-violet-700 bg-violet-100 border border-transparent rounded-lg cursor-pointer transition-all duration-200 hover:bg-violet-200 hover:border-violet-300 hover:text-violet-800 active:bg-violet-300 active:text-violet-800"
          onClick={() => onUse(id)}
        >
          <span>使用</span>
        </button>
      </div>
    </div>
  );
} 