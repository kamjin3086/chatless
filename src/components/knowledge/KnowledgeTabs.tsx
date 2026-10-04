"use client";

import { cn } from "@/lib/utils";

const tabs = [
  { id: 'my', name: '我的知识库', disabled: false },
  { id: 'shared', name: '共享知识库', disabled: true },
  { id: 'templates', name: '模板', disabled: true },
  { id: 'query', name: '智能问答', disabled: true },
];

interface KnowledgeTabsProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export function KnowledgeTabs({ activeTab, onTabChange }: KnowledgeTabsProps) {
  return (
    <div className="flex border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 glass-surface">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => !tab.disabled && onTabChange(tab.id)}
          disabled={tab.disabled}
          className={cn(
            "tab-item relative px-6 py-3 text-sm font-medium cursor-pointer transition-colors duration-200",
            tab.disabled
              ? "text-slate-400 dark:text-slate-600 cursor-not-allowed"
              : activeTab === tab.id
              ? "text-primary dark:text-slate-100"
              : "text-slate-600 dark:text-slate-300 hover:text-primary dark:hover:text-primary"
          )}
        >
          {tab.name}
          {activeTab === tab.id && (
            <span className="absolute bottom-0 left-0 w-full h-0.5 bg-primary dark:bg-primary" />
          )}
        </button>
      ))}
    </div>
  );
} 