/**
 * 应用清理服务
 * 负责在应用关闭时执行必要的清理操作
 */

import { DatabaseService } from '@/lib/database/services/DatabaseService';

export class AppCleanupService {
  private static instance: AppCleanupService;
  private isCleaningUp = false;
 
  private constructor() {}

  static getInstance(): AppCleanupService {
    if (!AppCleanupService.instance) {
      AppCleanupService.instance = new AppCleanupService();
    }
    return AppCleanupService.instance;
  }

  /**
   * 执行应用清理
   */
  async cleanup(): Promise<void> {
    if (this.isCleaningUp) {
      return;
    }

    this.isCleaningUp = true;
    console.log('🧹 开始应用清理...');

    try {
      // 并行执行清理任务
      await Promise.allSettled([
        this.cleanupSSEConnections(),
        this.cleanupDatabaseConnections(),
        this.cleanupEmbeddingServices()
      ]);

      console.log('✅ 应用清理完成');
    } catch (error) {
      console.error('❌ 应用清理失败:', error);
    } finally {
      this.isCleaningUp = false;
    }
  }

  /**
   * 清理SSE连接
   */
  private async cleanupSSEConnections(): Promise<void> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('stop_sse').catch(() => {});
    } catch (error) {
      console.warn('⚠️ 清理SSE连接失败:', error);
    }
  }

  /**
   * 清理数据库连接
   */
  private async cleanupDatabaseConnections(): Promise<void> {
    try {
      const dbService = DatabaseService.getInstance();
      await dbService.close();
    } catch (error) {
      console.warn('⚠️ 清理数据库连接失败:', error);
    }
  }

  /**
   * 清理嵌入服务
   */
  private async cleanupEmbeddingServices(): Promise<void> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('cleanup_on_exit').catch(() => {});
    } catch (error) {
      console.warn('⚠️ 清理嵌入服务失败:', error);
    }
  }

  /**
   * 设置窗口关闭与最小化事件监听
   */
  async setupWindowCloseListener(): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const { confirm } = await import('@tauri-apps/plugin-dialog');
      const currentWindow = getCurrentWindow();

      await currentWindow.onCloseRequested(async (event) => {
        const { useUiPreferences } = await import('@/store/uiPreferences');
        const { useLocaleStore } = await import('@/store/localeStore');
        const uiPreferences = useUiPreferences.getState();
        const t = useLocaleStore.getState().t;

        if (uiPreferences.closeToTray) {
          const { trayManager } = await import('@/lib/tray');
          // Never hide the only window if the tray failed to initialize.
          if (trayManager.isReady()) {
            event.preventDefault();
            try {
              await currentWindow.hide();
            } catch (error) {
              console.warn('隐藏窗口到托盘失败:', error);
            }
            return;
          }
        }
        
        if (uiPreferences.showCloseConfirmation) {
          const confirmed = await confirm(t('dialog.closeApp.message'), {
            title: t('dialog.closeApp.title'),
          });

          if (!confirmed) {
            event.preventDefault();
            return;
          }
        }

        try {
          const { savePersistedWindowState } = await import('@/lib/window/windowState');
          await savePersistedWindowState();
        } catch (error) {
          console.warn('⚠️ 保存窗口状态失败（onCloseRequested）:', error);
        }

        await this.cleanup();
      });

      await this.setupMinimizeToTrayListener(currentWindow);
    } catch (error) {
      console.warn('⚠️ 设置窗口关闭监听器失败:', error);
      this.setupFallbackCloseListener();
    }
  }

  /**
   * 原生最小化按钮 → 隐藏到系统托盘
   */
  private async setupMinimizeToTrayListener(currentWindow: import('@tauri-apps/api/window').Window): Promise<void> {
    try {
      await currentWindow.onResized(async () => {
        const { useUiPreferences } = await import('@/store/uiPreferences');
        if (!useUiPreferences.getState().minimizeToTray) return;

        try {
          const minimized = await currentWindow.isMinimized();
          if (minimized) {
            await currentWindow.hide();
          }
        } catch (error) {
          console.warn('⚠️ 最小化到托盘失败:', error);
        }
      });
    } catch (error) {
      console.warn('⚠️ 设置最小化到托盘监听器失败:', error);
    }
  }

  /**
   * 设置备用关闭事件监听器
   */
  private setupFallbackCloseListener(): void {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
      
      setTimeout(() => {
        void (async () => {
          try {
            const { savePersistedWindowState } = await import('@/lib/window/windowState');
            await savePersistedWindowState();
          } catch (error) {
            console.warn('⚠️ 保存窗口状态失败（beforeunload）:', error);
          }
          this.cleanup().catch(console.error);
        })();
      }, 100);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
  }
}

// 导出单例实例
export const appCleanupService = AppCleanupService.getInstance();
