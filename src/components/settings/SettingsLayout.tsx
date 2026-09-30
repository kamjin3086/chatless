"use client";

import { SettingsSidebar } from "./SettingsSidebar";
import { useProviderManagement } from '@/hooks/useProviderManagement';
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface SettingsLayoutProps {
  children: React.ReactNode;
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export function SettingsLayout({ children, activeTab, onTabChange }: SettingsLayoutProps) {
  // 进入设置界面即预加载 AI 提供商状态，避免首次点击时出现 "未知" 状态
  useProviderManagement();
  // 保持滚动位置（按 tab 维度）
  const mainRef = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      const key = `settings_scroll_${activeTab}`;
      const saved = typeof window !== 'undefined' ? window.sessionStorage.getItem(key) : null;
      if (saved && mainRef.current) {
        const y = parseInt(saved, 10);
        if (!Number.isNaN(y)) mainRef.current.scrollTop = y;
      }
    } catch {}
  }, [activeTab]);

  const handleScroll = () => {
    if (!mainRef.current) return;
    const key = `settings_scroll_${activeTab}`;
    const save = () => {
      try { window.sessionStorage.setItem(key, String(mainRef.current!.scrollTop)); } catch {}
    };
    // 简单节流，避免频繁写入
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(save, 120);
  };

  // 监听内容结构变化，若出现滚动位置被重置为 0，则恢复到上次位置
  // 优化：添加防抖和智能判断，避免与组件内部滚动控制冲突
  useEffect(() => {
    const el = mainRef.current;
    if (!el || typeof window === 'undefined') return;
    const key = `settings_scroll_${activeTab}`;
    let debounceTimer: number | null = null;
    let lastScrollTime = 0;
    
    const observer = new MutationObserver(() => {
      // 防抖处理，避免频繁操作
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        try {
          const saved = window.sessionStorage.getItem(key);
          const y = saved ? parseInt(saved, 10) : 0;
          const now = Date.now();
          // 只在滚动位置被重置到顶部 且 距离上次滚动超过300ms 时才恢复
          // 这样可以避免与刷新时的滚动锁定机制冲突
          if (y > 0 && el.scrollTop <= 2 && now - lastScrollTime > 300) {
            el.scrollTop = y;
          }
        } catch {}
      }, 100);
    });
    
    const trackScrollTime = () => {
      lastScrollTime = Date.now();
    };
    
    el.addEventListener('scroll', trackScrollTime, { passive: true });
    observer.observe(el, { childList: true, subtree: true });
    return () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      el.removeEventListener('scroll', trackScrollTime);
      observer.disconnect();
    };
  }, [activeTab]);

  const isProviderManager = activeTab === "localModels";

  return (
    <div className={cn(
      "flex flex-col h-full overflow-hidden",
      !isProviderManager && "settings-shell"
    )}>
        <div className="flex flex-1 min-h-0 overflow-hidden">
             <SettingsSidebar activeTab={activeTab} onTabChange={onTabChange} />
             <main
               ref={mainRef}
               onScroll={handleScroll}
               className={cn(
                 "settings-main flex-1 min-h-0 custom-scrollbar text-sm",
                 isProviderManager
                   ? "overflow-hidden p-0"
                   : "overflow-y-auto px-5 py-4"
               )}
             >
               {children}
             </main>
        </div>
    </div>
  );
} 