"use client";

import { useEffect, useRef } from 'react';
import { useChatStore } from "@/store/chatStore";
import { AppPageSwitcher, Sidebar } from './Sidebar';
import { useUiPreferences } from '@/store/uiPreferences';
import { isAndroidRuntime, isMobileRuntime } from '@/lib/utils/runtimePlatform';
import { ThemeInitializer } from './theme/ThemeInitializer';
import { GlassThemeApplier } from './theme/GlassThemeApplier';
import { NightBrightnessApplier } from './theme/NightBrightnessApplier';
import { appCleanupService } from '@/lib/services/appCleanup';
import { StartupUpdateToast } from '@/components/update/StartupUpdateToast';
import { initializeTauriApp } from './initializeTauriApp';

interface TauriAppProps {
  children: React.ReactNode;
}

export function TauriApp({ children }: TauriAppProps) {
  const loadConversations = useChatStore((state) => state.loadConversations);
  const appNavCollapsed = useUiPreferences((state) => state.appNavCollapsed);
  // 使用 ref 来防止重复初始化
  const hasInitializedRef = useRef(false);
  const initializationPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const initializeApp = async () => {
      // 防止重复初始化
      if (hasInitializedRef.current) {
        console.log('🔄 [TauriApp] 应用已初始化，跳过重复初始化');
        return;
      }

      // 如果正在初始化中，等待现有初始化完成
      if (initializationPromiseRef.current) {
        console.log('🔄 [TauriApp] 等待现有初始化完成...');
        await initializationPromiseRef.current;
        return;
      }

      // 创建新的初始化Promise
      initializationPromiseRef.current = initializeTauriApp(loadConversations);
      
      try {
        await initializationPromiseRef.current;
        hasInitializedRef.current = true;
        
        // 应用初始化完成后，设置窗口关闭事件监听
        if (!isMobileRuntime()) {
          appCleanupService.setupWindowCloseListener().catch(error => {
            console.warn('⚠️ 设置窗口关闭事件监听器失败:', error);
          });
        }
      } catch (error) {
        console.error('❌ [TauriApp] 应用初始化失败:', error);
        // 重置状态，允许重试
        hasInitializedRef.current = false;
        initializationPromiseRef.current = null;
      }
    };

    initializeApp();
  }, [loadConversations]);

  return (
    <>
      <ThemeInitializer />
      <GlassThemeApplier />
      <NightBrightnessApplier />
      {!isMobileRuntime() && <StartupUpdateToast />}
      {isAndroidRuntime() ? (
        <div className="relative h-full min-w-0 overflow-hidden glass-surface">{children}</div>
      ) : (
      <div className="relative flex h-full custom-titlebar-content">
        {!appNavCollapsed && <Sidebar />}
        <div
          className="glass-shell flex-1 relative"
          data-app-nav-collapsed={appNavCollapsed || undefined}
          style={{ marginLeft: appNavCollapsed ? 0 : 'var(--sidebar-width, 4.5rem)' }}
        >
          <div className="glass-shell-inner relative flex h-full min-h-0 flex-col overflow-x-hidden">
            {appNavCollapsed && (
              <div className="app-page-switcher-fallback glass-surface flex h-9 shrink-0 items-center border-b border-slate-300/60 px-2 dark:border-white/10">
                <AppPageSwitcher />
              </div>
            )}
            <div className="glass-shell-content relative min-h-0 flex-1">{children}</div>
          </div>
        </div>
      </div>
      )}
    </>
  );
}

// 默认导出以保持向后兼容
export default TauriApp; 
