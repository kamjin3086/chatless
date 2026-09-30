"use client";

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageTabs } from '@/components/ui/PageTabs';
import { SkillsPage } from '@/components/skills/SkillsPage';
import { McpServersSettings } from '@/components/settings/McpServersSettings';
import { Sparkles, Plug } from 'lucide-react';

const tabs = [
  { id: 'skills', label: '技能', icon: <Sparkles className="w-4 h-4" /> },
  { id: 'mcp', label: 'MCP 服务', icon: <Plug className="w-4 h-4" /> },
];

export default function ExtensionsPage() {
  const searchParams = useSearchParams();
  
  // Tab 状态，支持 URL 参数
  const [activeTab, setActiveTab] = useState<string>(() => {
    const tabParam = searchParams.get('tab');
    return tabParam === 'skills' || tabParam === 'mcp' ? tabParam : 'skills';
  });

  // URL 参数同步
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'skills' || tabParam === 'mcp') {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  return (
    <div className="flex flex-col h-full overflow-hidden glass-surface">
      {/* 顶部 Tab */}
      <PageTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        className="glass-surface"
      />

      {/* 内容区域 */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'skills' ? (
          <SkillsPage className="h-full" />
        ) : (
          <div className="h-full overflow-auto">
            <McpServersSettings />
          </div>
        )}
      </div>
    </div>
  );
}
