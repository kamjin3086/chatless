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
import { translate } from '@/i18n';
import { shouldShowAboutBlueDot, UPDATE_AVAILABILITY_EVENT, checkForUpdatesSilently } from '@/lib/update/update-notifier';
import { useLocaleStore } from '@/store/localeStore';

const settingsTabs = [
  { id: 'general', labelKey: 'settings.nav.general', icon: SlidersHorizontal },
  { id: 'localModels', labelKey: 'settings.nav.localModels', icon: Bot },
  { id: 'knowledgeBase', labelKey: 'settings.nav.knowledgeBase', icon: Database },
  { id: 'sync', labelKey: 'settings.nav.sync', icon: Cloud },
  { id: 'webSearch', labelKey: 'settings.nav.webSearch', icon: Globe },
  { id: 'privacySecurity', labelKey: 'settings.nav.privacySecurity', icon: ShieldCheck },
  { id: 'advanced', labelKey: 'settings.nav.advanced', icon: Settings },
  { id: 'aboutSupport', labelKey: 'settings.nav.aboutSupport', icon: Info },
] as const;

interface SettingsSidebarProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export function SettingsSidebar({ activeTab, onTabChange }: SettingsSidebarProps) {
  const locale = useLocaleStore((state) => state.locale);
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
        <h3 className="font-medium text-slate-800 dark:text-slate-200 text-sm">{translate(locale, 'nav.settings')}</h3>
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
                {translate(locale, tab.labelKey)}
                {isAbout && showAboutDot && !isActive && (
                  <span
                    className="ml-auto inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-medium leading-tight text-slate-600 bg-slate-200/70 dark:text-slate-300 dark:bg-white/10"
                  >
                    {translate(locale, 'settings.nav.updateBadge')}
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
