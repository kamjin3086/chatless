import { TrayIcon } from '@tauri-apps/api/tray';
import { Menu } from '@tauri-apps/api/menu';
import { PredefinedMenuItem } from '@tauri-apps/api/menu';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { resolveResource } from '@tauri-apps/api/path';
import { Image } from '@tauri-apps/api/image';
import { defaultWindowIcon } from '@tauri-apps/api/app';
import { platform } from '@tauri-apps/plugin-os';
import { translate } from '@/i18n';
import { useLocaleStore } from '@/store/localeStore';

// 系统托盘管理类
class SystemTrayManager {
  private tray: TrayIcon | null = null;
  private isInitialized = false;

  isReady(): boolean {
    return this.isInitialized && this.tray !== null;
  }

  // 初始化系统托盘
  async initialize() {
    if (this.isInitialized) return;

    try {
      const locale = useLocaleStore.getState().locale;
      const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);

      // 创建真正的分割线
      const separator1 = await PredefinedMenuItem.new({ item: 'Separator' });
      const separator2 = await PredefinedMenuItem.new({ item: 'Separator' });

      // 创建菜单项并直接绑定事件处理器
      const menu = await Menu.new({
        items: [
          {
            id: 'new_chat',
            text: t('tray.newChat'),
            action: () => this.createNewChat()
          },
          separator1,
          {
            id: 'minimize',
            text: t('tray.minimize'),
            action: () => this.minimizeToTray()
          },
          separator2,
          {
            id: 'settings',
            text: t('tray.settings'),
            action: () => this.navigateTo('settings')
          },
          {
            id: 'quit',
            text: t('tray.quit'),
            action: () => this.quit()
          }
        ]
      });

  
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
        menuOnLeftClick: false, // 左键点击不显示菜单
        action: (event) => {
          // 处理托盘图标点击事件
          if (event.type === 'Click' && event.button === 'Left' && event.buttonState === 'Up') {
            this.toggleWindow();
          }
        }
      });

      this.isInitialized = true;
      console.log('系统托盘初始化成功');
    } catch (error) {
      console.error('系统托盘初始化失败:', error);
    }
  }

  // 显示窗口
  private async showWindow() {
    try {
      const window = getCurrentWindow();
      await window.show();
      await window.setFocus();
    } catch (error) {
      console.error('显示窗口失败:', error);
    }
  }

  // 隐藏窗口
  private async hideWindow() {
    try {
      const window = getCurrentWindow();
      await window.hide();
    } catch (error) {
      console.error('隐藏窗口失败:', error);
    }
  }

  // 切换窗口显示/隐藏
  private async toggleWindow() {
    try {
      const window = getCurrentWindow();
      const isVisible = await window.isVisible();
      
      if (isVisible) {
        await window.hide();
      } else {
        await window.show();
        await window.setFocus();
      }
    } catch (error) {
      console.error('切换窗口状态失败:', error);
    }
  }

  // 确保窗口显示并获取焦点
  private async ensureWindowVisible() {
    try {
      const window = getCurrentWindow();
      await window.show();
      await window.setFocus();
    } catch (error) {
      console.error('显示窗口失败:', error);
    }
  }

  // 导航到指定页面
  private async navigateTo(page: string) {
    try {
      // 确保窗口显示
      await this.ensureWindowVisible();
      
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
      // 确保窗口显示
      await this.ensureWindowVisible();
      
      const window = getCurrentWindow();
      // 发送创建新聊天事件到前端
      await window.emit('create-new-chat');
    } catch (error) {
      console.error('创建新聊天失败:', error);
    }
  }

  // 最小化到托盘
  private async minimizeToTray() {
    try {
      const window = getCurrentWindow();
      await window.hide();
    } catch (error) {
      console.error('最小化到托盘失败:', error);
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
    if (!this.tray || !this.isInitialized) return;

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
    if (!this.tray || !this.isInitialized) return;

    try {
      await this.tray.setTooltip(tooltip);
    } catch (error) {
      console.error('设置托盘工具提示失败:', error);
    }
  }
}

// 创建全局实例
const trayManager = new SystemTrayManager();

// 导出实例和类
export { trayManager, SystemTrayManager }; 
