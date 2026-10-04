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
    <div className="settings-rail w-44 shrink-0 border-r border-slate-200/40 dark:border-slate-800/40 overflow-y-auto custom-scrollbar flex flex-col h-full select-none">
      <div className="px-3 pt-3 pb-1.5 flex items-center justify-between flex-shrink-0" data-tauri-drag-region>
        <h3 className="font-medium text-slate-800 dark:text-slate-200 text-sm">设置</h3>
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
                  ? "bg-slate-200/55 dark:bg-white/10 text-slate-800 dark:text-slate-100 font-medium" 
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 hover:text-slate-900 dark:hover:text-slate-200"
              )}
            >
              <Icon className={cn(
                "w-4 h-4 flex-shrink-0",
                isActive ? "text-slate-700 dark:text-slate-200" : "text-slate-500 dark:text-slate-400"
              )} />
              <span className="truncate flex items-center gap-2 flex-1">
                {tab.name}
                {isAbout && showAboutDot && !isActive && (
                  <span
                    className="ml-auto inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-medium leading-tight text-slate-600 bg-slate-200/70 dark:text-slate-300 dark:bg-white/10"
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
