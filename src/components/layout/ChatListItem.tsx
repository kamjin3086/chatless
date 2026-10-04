"use client";

import { MessageSquare, Star, MoreHorizontal, FolderOpen } from 'lucide-react';
import { cn } from "@/lib/utils";

interface ChatListItemProps {
  id: string;
  title: string;
  model?: string;
  time?: string;
  tags?: string[];
  category?: string;
  isActive?: boolean;
  isUnread?: boolean;
  isStarred?: boolean;
  onSelect: (id: string) => void;
  onStarToggle?: (id: string) => void;
  onMoreActions?: (id: string) => void;
}

export function ChatListItem({
  id,
  title,
  model,
  time,
  tags,
  category,
  isActive = false,
  isUnread = false,
  isStarred = false,
  onSelect,
  onStarToggle,
  onMoreActions
}: ChatListItemProps) {
  if (category) {
    return (
      <div className="flex items-center py-2 px-2 mt-2">
        <FolderOpen className="w-4 h-4 text-secondary dark:text-secondary mr-2" />
        <span className="text-sm font-medium text-secondary dark:text-secondary">{category}</span>
      </div>
    );
  }
  
  return (
    <div
      className={cn(
        "chat-list-item flex items-center p-2 rounded-md mb-1 cursor-pointer transition-all duration-200 group",
        isActive
          ? "bg-slate-200/50 dark:bg-slate-700/50 border border-slate-300/50 dark:border-slate-600/50 hover:shadow-md scale-[1.01]"
          : "bg-white/60 dark:bg-slate-800/60 hover:bg-slate-100/60 dark:hover:bg-slate-700/60 hover:scale-[1.02] hover:shadow-sm",
        isUnread && !isActive && "bg-slate-100/50 dark:bg-slate-800/40 border-l-2 border-slate-400/60 dark:border-slate-500/50 relative"
      )}
      onClick={() => onSelect(id)}
    >
      <div className="text-secondary dark:text-primary mr-2">
        <MessageSquare className="w-5 h-5" />
      </div>
      <div className="flex-1 overflow-hidden">
        <div className={cn(
          "truncate font-medium text-[13px] sm:text-sm",
          isActive ? "text-slate-800 dark:text-white" : "text-slate-800 dark:text-slate-200"
        )}>{title}</div>
        <div className="flex flex-wrap items-center text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 gap-x-2 gap-y-0.5 mt-0.5 max-w-full">
          {time && <span>{time}</span>}
          {model && <span className="text-secondary dark:text-primary font-medium">{model}</span>}
        </div>
        {tags && tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {tags.map((tag, index) => (
              <span 
                key={index}
                className="inline-block text-xs font-mono bg-slate-100/70 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-600/50 px-1.5 py-0.5 rounded-md text-slate-600 dark:text-slate-300"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        {onStarToggle && (
          <button 
            className={cn(
              "p-1 rounded-md transition-colors duration-200 cursor-pointer",
              isStarred 
                ? "text-accent dark:text-yellow-400 hover:bg-red-100/50 dark:hover:bg-red-800/40"
                : "text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-600/70 hover:text-slate-600 dark:hover:text-slate-300"
            )}
            title="收藏"
            onClick={(e) => { e.stopPropagation(); onStarToggle(id); }}
          >
            <Star className="w-4 h-4" />
          </button>
        )}
        {onMoreActions && (
          <button 
            className="p-1 text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-600/70 rounded-md transition-colors duration-200 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer"
            title="更多"
            onClick={(e) => { e.stopPropagation(); onMoreActions(id); }}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        )}
      </div>
      {isUnread && !isActive && (
        <div className="unread-dot absolute top-1.5 right-1.5 bg-red-500 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-800 animate-pulse opacity-80"></div>
      )}
    </div>
  );
} 