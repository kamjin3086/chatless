"use client";

import { cn } from "@/lib/utils";
import { 
  SlidersHorizontal, 
  ShieldCheck, 
  Bot, 
  Settings,
  Database,
  Info,
  Plug,
  Globe,
  Cloud
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { shouldShowAboutBlueDot, UPDATE_AVAILABILITY_EVENT, checkForUpdatesSilently } from '@/lib/update/update-notifier';

const settingsTabs = [
  { id: 'general', name: '常规', icon: SlidersHorizontal },
  { id: 'localModels', name: 'AI模型', icon: Bot },
  { id: 'knowledgeBase', name: '知识库', icon: Database },
  { id: 'sync', name: '同步', icon: Cloud },
  { id: 'webSearch', name: '网络搜索', icon: Globe },
  { id: 'privacySecurity', name: '安全', icon: ShieldCheck },
  { id: 'advanced', name: '高级', icon: Settings },
  { id: 'aboutSupport', name: '关于', icon: Info },
];

interface SettingsSidebarProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export function SettingsSidebar({ activeTab, onTabChange }: SettingsSidebarProps) {
  const [showAboutDot, setShowAboutDot] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const show = await shouldShowAboutBlueDot();
        if (mounted) setShowAboutDot(show);
      } catch {}
      // 进入设置页时主动触发一次静默检查，避免首次加载竞态
      try { await checkForUpdatesSilently(); } catch {}
    })();
    const onChanged = async () => {
      const show = await shouldShowAboutBlueDot();
      if (mounted) setShowAboutDot(show);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener(UPDATE_AVAILABILITY_EVENT, onChanged as EventListener);
    }
    return () => {
      mounted = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener(UPDATE_AVAILABILITY_EVENT, onChanged as EventListener);
      }
    };
  }, []);

  // 进入“关于”标签时立刻隐藏蓝点（并由 settings/page.ts 记录查看时间）
  useEffect(() => {
    if (activeTab === 'aboutSupport') {
      setShowAboutDot(false);
    }
  }, [activeTab]);
  return (
    <div className="w-44 border-r border-gray-200/40 dark:border-gray-800/40 overflow-y-auto custom-scrollbar bg-white/90 dark:bg-gray-900/90 flex flex-col h-full select-none">
      {/* Header */}
      <div className="px-3 py-2 flex items-center justify-between border-b border-gray-200/40 dark:border-gray-800/40 flex-shrink-0">
        <h3 className="font-medium text-gray-800 dark:text-gray-200 text-sm">设置</h3>
      </div>
      
      {/* Settings Tabs */}
      <div className="flex-1 p-2 space-y-1">
        {settingsTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          
          const isAbout = tab.id === 'aboutSupport';
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-colors duration-150",
                isActive 
                  ? "bg-blue-50/80 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-medium" 
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100/60 dark:hover:bg-gray-800/40 hover:text-gray-900 dark:hover:text-gray-200"
              )}
            >
              <Icon className={cn(
                "w-4 h-4 flex-shrink-0",
                isActive ? "text-blue-600 dark:text-blue-400" : "text-gray-500 dark:text-gray-400"
              )} />
              <span className="truncate flex items-center gap-2 flex-1">
                {tab.name}
                {isAbout && showAboutDot && !isActive && (
                  <span
                    className="ml-auto inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium leading-tight text-blue-600 bg-blue-100 dark:text-blue-300 dark:bg-blue-900/40"
                  >
                    NEW
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
} 
