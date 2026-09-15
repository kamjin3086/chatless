import { KnowledgeFilterBar } from "./KnowledgeFilterBar";
import { KnowledgeTabs } from "./KnowledgeTabs";

export interface KnowledgeLayoutProps {
  children: React.ReactNode;
  activeTab: string;
  onTabChange: (tabId: string) => void;
  activeFilter: string;
  onFilterChange: (filterId: string) => void;
  sortBy: string;
  onSortChange: (sortValue: string) => void;
  onCreateKnowledgeBase?: () => void;
}

export function KnowledgeLayout({
  children,
  activeTab,
  onTabChange,
  activeFilter,
  onFilterChange,
  sortBy,
  onSortChange,
  onCreateKnowledgeBase,
}: KnowledgeLayoutProps) {
  return (
    <div className="flex flex-col h-full border border-slate-200/60 dark:border-slate-800/60 overflow-hidden overflow-x-hidden glass-surface">
      {/* 顶栏已移除，创建功能移动至筛选栏菜单 */}
      <KnowledgeTabs activeTab={activeTab} onTabChange={onTabChange} />
      <KnowledgeFilterBar 
        activeFilter={activeFilter} 
        onFilterChange={onFilterChange}
        sortBy={sortBy}
        onSortChange={onSortChange}
        onCreateKnowledgeBase={onCreateKnowledgeBase}
      />
      <main className="flex-1 overflow-y-auto overflow-x-hidden p-6 custom-scrollbar glass-surface">
        {children}
      </main>
    </div>
  );
} 