'use client';

import { cn } from '@/lib/utils';

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface PageTabsProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

/**
 * 统一的页面顶部 Tab 组件
 * 极简设计：无边框、无背景，仅用底部细线指示当前选中
 * 用于合并页面的 Tab 切换，确保切换自然无割裂感
 */
export function PageTabs({ tabs, activeTab, onTabChange, className }: PageTabsProps) {
  return (
    <div className={cn("app-topbar border-b border-slate-200/50 dark:border-slate-700/30", className)}>
      <nav className="flex gap-0.5 px-4 min-h-8 items-center">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "px-3 py-1.5 text-sm transition-colors relative flex items-center gap-1.5",
              activeTab === tab.id
                ? "text-slate-800 dark:text-slate-100"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
            )}
          >
            {tab.icon}
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-slate-700 dark:bg-slate-300 rounded-full" />
            )}
          </button>
        ))}
        <div className="flex-1 h-8 min-w-4" data-tauri-drag-region />
      </nav>
    </div>
  );
}
