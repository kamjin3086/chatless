import { TrayIcon } from '@tauri-apps/api/tray';
import { Menu, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { resolveResource } from '@tauri-apps/api/path';
import { Image } from '@tauri-apps/api/image';
import { defaultWindowIcon } from '@tauri-apps/api/app';
import { platform } from '@tauri-apps/plugin-os';
import { translate } from '@/i18n';
import type { Locale } from '@/i18n/types';
import { useLocaleStore } from '@/store/localeStore';
import { restoreWindow, trayClickAction } from './trayClick';
import {
  TRAY_MENU_ORDER,
  TRAY_SEPARATOR_AFTER,
  trayItemLabelKey,
  trayItemRestoresWindow,
  type TrayMenuItemId,
} from './trayMenu';

function waitForTrayLocale(): Promise<Locale> {
  const { locale, initialized } = useLocaleStore.getState();
  if (initialized) return Promise.resolve(locale);

  return new Promise((resolve) => {
    const unsubscribe = useLocaleStore.subscribe((state) => {
      if (!state.initialized) return;
      unsubscribe();
      resolve(state.locale);
    });
  });
}

// 系统托盘管理类
class SystemTrayManager {
  private tray: TrayIcon | null = null;
  private initializing: Promise<void> | null = null;

  isReady(): boolean {
    return this.tray !== null;
  }

  initialize(): Promise<void> {
    if (this.initializing) return this.initializing;
    if (this.tray) return Promise.resolve();

    this.initializing = this.createTray().finally(() => {
      this.initializing = null;
    });
    return this.initializing;
  }

  private async createTray() {
    try {
      const locale = await waitForTrayLocale();

      // Linux left click opens this menu, so Show Window stays first.
      const items: Array<MenuItem | PredefinedMenuItem> = [];
      const menuItems = new Map<TrayMenuItemId, MenuItem>();
      for (const id of TRAY_MENU_ORDER) {
        const item = await MenuItem.new({
          id,
          text: translate(locale, trayItemLabelKey(id)),
          action: () => void this.runMenuItem(id),
        });
        menuItems.set(id, item);
        items.push(item);
        if (TRAY_SEPARATOR_AFTER.includes(id)) {
          items.push(await PredefinedMenuItem.new({ item: 'Separator' }));
        }
      }
      const menu = await Menu.new({ items });

      let iconPath: string | undefined = undefined;
      try {
        // macos使用打包资源中额外的托盘图标，windows使用默认图标
        if (platform() === 'macos') {
          iconPath = await resolveResource('icons-macos/tray-icon.png');
        }
      } catch (_) {
        // 忽略，走默认图标
      }

      const defaultIcon = await defaultWindowIcon()

      // 将路径转换为 Image（期望 RGBA 数据）
      const iconImage = iconPath ? await Image.fromPath(iconPath) : undefined;

      // 创建系统托盘
      this.tray = await TrayIcon.new({
        tooltip: 'chatless',
        icon: iconImage || defaultIcon || 'icons/icon.ico',
        menu,
        // A Linux tray icon is an AppIndicator: its click opens the attached menu and no
        // click event is delivered, so pointing the left button at the menu is the only way
        // the window can be reached from there. Elsewhere the click toggles the window.
        menuOnLeftClick: platform() === 'linux',
        action: (event) => {
          // 处理托盘图标点击事件
          if (event.type === 'Click' && event.button === 'Left' && event.buttonState === 'Up') {
            this.toggleWindow();
          }
        }
      });

      // Relabel the attached menu in place and serialize writes so a slow native
      // update cannot overwrite a newer locale selection.
      let menuUpdate = Promise.resolve();
      const updateMenuLocale = (nextLocale: Locale) => {
        menuUpdate = menuUpdate
          .then(async () => {
            for (const [id, item] of menuItems) {
              await item.setText(translate(nextLocale, trayItemLabelKey(id)));
            }
          })
          .catch((error) =>
            console.error('Could not update tray menu labels:', error),
          );
      };
      useLocaleStore.subscribe((state, previous) => {
        if (state.locale !== previous.locale) updateMenuLocale(state.locale);
      });
      // A selection may have landed while native tray creation was in flight.
      const currentLocale = useLocaleStore.getState().locale;
      if (currentLocale !== locale) updateMenuLocale(currentLocale);
      await menuUpdate;

      console.log('系统托盘初始化成功');
    } catch (error) {
      console.error('系统托盘初始化失败:', error);
    }
  }

  /**
   * Bring the window forward, whatever state it is in. A minimized window is "visible", so
   * `show()` alone leaves it minimized in the taskbar - the click that appears to do nothing.
   */
  private async bringWindowForward() {
    await restoreWindow(getCurrentWindow(), (step, error) =>
      console.error('restore window step failed:', step, error),
    );
  }

  private async toggleWindow() {
    try {
      const window = getCurrentWindow();
      const action = trayClickAction({
        visible: await window.isVisible(),
        minimized: await window.isMinimized(),
      });
      if (action === 'hide') await window.hide();
      else await this.bringWindowForward();
    } catch (error) {
      console.error('切换窗口状态失败:', error);
    }
  }

  /**
   * One entry point for every menu item: restore first when the item is about reaching the
   * window, then do what the item says. Quit is the one exception - it exits, and restoring
   * first would only flash a window on the way out.
   */
  private async runMenuItem(id: TrayMenuItemId) {
    if (trayItemRestoresWindow(id)) await this.bringWindowForward();
    try {
      switch (id) {
        case 'show':
          return; // bringing it forward is the whole action
        case 'new_chat':
          return this.createNewChat();
        case 'settings':
          return this.navigateTo('settings');
        case 'quit':
          return this.quit();
      }
    } catch (error) {
      console.error(`托盘菜单项 ${id} 执行失败:`, error);
    }
  }

  // 导航到指定页面
  private async navigateTo(page: string) {
    try {
      const window = getCurrentWindow();
      // 发送导航事件到前端
      await window.emit('navigate', page);
    } catch (error) {
      console.error(`导航到${page}失败:`, error);
    }
  }

  // 创建新聊天会话
  private async createNewChat() {
    try {
      const window = getCurrentWindow();
      // 发送创建新聊天事件到前端
      await window.emit('create-new-chat');
    } catch (error) {
      console.error('创建新聊天失败:', error);
    }
  }

  // 退出应用
  private async quit() {
    try {
      this.tray?.close();

      // 使用 Tauri 的 exit 命令
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('exit', { code: 0 });
    } catch (error) {
      console.error('退出应用失败:', error);
    }
  }

  // 设置托盘图标
  async setIcon(iconPath: string) {
    if (!this.tray) return;

    try {
      const path = iconPath.includes('/') || iconPath.includes('\\')
        ? iconPath
        : await resolveResource(iconPath);
      const image = await Image.fromPath(path);
      await this.tray.setIcon(image);
    } catch (error) {
      console.error('设置托盘图标失败:', error);
    }
  }

  // 设置托盘工具提示
  async setTooltip(tooltip: string) {
    if (!this.tray) return;

    try {
      await this.tray.setTooltip(tooltip);
    } catch (error) {
      console.error('设置托盘工具提示失败:', error);
    }
  }
}

// Single-flight initialization is scoped to this WebView; a full reload may leave the native tray alive.
const trayManager = new SystemTrayManager();

export { trayManager, SystemTrayManager };
