"use client";

import { Settings } from 'lucide-react';
import { cn } from "@/lib/utils";

interface SidebarHeaderProps {
  userName: string;
  avatarUrl: string; // You might want to replace this with a proper Avatar component
  onSettingsClick: () => void;
  className?: string;
}

export function SidebarHeader({
  userName,
  avatarUrl,
  onSettingsClick,
  className
}: SidebarHeaderProps) {
  return (
    <div className={cn(
      "p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between",
      className
    )}>
      <div className="flex items-center gap-3">
        {/* Placeholder for Avatar */}
        <div className="w-8 h-8 rounded-full bg-gradient-to-r from-primary to-secondary text-white flex items-center justify-center font-semibold shadow-md">
          {userName.charAt(0).toUpperCase()}
        </div>
        <div className="font-medium text-slate-800 dark:text-slate-200">{userName}</div>
      </div>
      <button 
        className="text-slate-600 dark:text-slate-400 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 p-1.5 rounded-md transition-all duration-200 icon-shadow" 
        title="设置"
        onClick={onSettingsClick}
      >
        <Settings className="w-5 h-5 gradient-icon" />
      </button>
    </div>
  );
} 