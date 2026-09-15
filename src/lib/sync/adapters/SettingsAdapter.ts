/**
 * 用户设置同步适配器
 * 
 * 同步用户的界面偏好设置，如主题、字体大小、布局等。
 * 将所有设置作为一个单独的文档进行同步。
 */

import { BaseSyncAdapter, type SyncDoc } from '../core/SyncAdapter';
import type { SyncDataType, SyncMetadataEntry, SyncItem } from '../core/types';
import { useUiPreferences } from '@/store/uiPreferences';
import { useMarkdownPreferences } from '@/store/markdownPreferences';

/** 用户设置的单一 ID（所有设置作为一个文档） */
const SETTINGS_DOC_ID = 'user-settings';

/**
 * 用户设置同步文档格式
 */
export interface SettingsSyncDoc extends SyncDoc {
  id: string;
  
  // UI 偏好
  ui?: {
    showSettingIcons?: boolean;
    simpleMode?: boolean;
    lowAnimationMode?: boolean;
    settingsIconPreset?: string;
    sidebarWidth?: string;
    collapseChatSidebar?: boolean;
    sidebarIconSize?: string;
    timezone?: string;
    cmdPaletteEnabled?: boolean;
    cmdPaletteShortcut?: string;
    showCloseConfirmation?: boolean;
    charFadeIntensity?: string;
    windowSizePreset?: string;
    glassTheme?: boolean;
    nightBrightness?: number;
  };
  
  // Markdown 偏好
  markdown?: {
    fontSize?: string;
  };
  
  // 更新时间
  updated_at: number;
  deleted_at?: number | null;
  updated_by_device_id?: string | null;
}

/**
 * 用户设置本地数据格式
 */
export interface SettingsSyncItem extends SyncItem {
  id: string;
  ui?: SettingsSyncDoc['ui'];
  markdown?: SettingsSyncDoc['markdown'];
  updated_at: number;
  deleted_at?: number | null;
  updated_by_device_id?: string | null;
}

/**
 * 用户设置同步适配器实现
 */
export class SettingsAdapter extends BaseSyncAdapter<SettingsSyncItem, SettingsSyncDoc> {
  readonly dataType: SyncDataType = 'settings';
  readonly remotePath = 'settings/data';
  readonly displayName = '用户设置';

  /**
   * 从各个 Store 收集当前设置
   */
  private collectSettings(): SettingsSyncItem {
    const uiState = useUiPreferences.getState();
    const mdState = useMarkdownPreferences.getState();
    
    return {
      id: SETTINGS_DOC_ID,
      ui: {
        showSettingIcons: uiState.showSettingIcons,
        simpleMode: uiState.simpleMode,
        lowAnimationMode: uiState.lowAnimationMode,
        settingsIconPreset: uiState.settingsIconPreset,
        sidebarWidth: uiState.sidebarWidth,
        collapseChatSidebar: uiState.collapseChatSidebar,
        sidebarIconSize: uiState.sidebarIconSize,
        timezone: uiState.timezone,
        cmdPaletteEnabled: uiState.cmdPaletteEnabled,
        cmdPaletteShortcut: uiState.cmdPaletteShortcut,
        showCloseConfirmation: uiState.showCloseConfirmation,
        charFadeIntensity: uiState.charFadeIntensity,
        windowSizePreset: uiState.windowSizePreset,
        glassTheme: uiState.glassTheme,
        nightBrightness: uiState.nightBrightness,
      },
      markdown: {
        fontSize: mdState.fontSize,
      },
      updated_at: Date.now(),
      deleted_at: null,
      updated_by_device_id: null,
    };
  }

  /**
   * 获取所有本地设置（作为单个项）
   */
  async getLocalItems(): Promise<SettingsSyncItem[]> {
    return [this.collectSettings()];
  }

  /**
   * 根据 ID 获取本地设置
   */
  async getLocalItem(id: string): Promise<SettingsSyncItem | null> {
    if (id !== SETTINGS_DOC_ID) return null;
    return this.collectSettings();
  }

  /**
   * 检查本地是否存在设置
   */
  async localItemExists(id: string): Promise<boolean> {
    return id === SETTINGS_DOC_ID;
  }

  /**
   * 创建/应用本地设置
   */
  async createLocalItem(item: SettingsSyncItem, deviceId: string): Promise<void> {
    await this.applySettings(item);
  }

  /**
   * 更新本地设置
   */
  async updateLocalItem(id: string, item: SettingsSyncItem, deviceId: string): Promise<void> {
    await this.applySettings(item);
  }

  /**
   * 删除本地设置（重置为默认）
   */
  async deleteLocalItem(id: string, deletedAt: number, deviceId: string): Promise<void> {
    // 设置不支持删除，忽略
  }

  /**
   * 应用设置到各个 Store 和存储
   */
  private async applySettings(item: SettingsSyncItem): Promise<void> {
    const { ui, markdown } = item;
    
    // 应用 UI 设置
    if (ui) {
      const uiStore = useUiPreferences.getState();
      
      if (ui.showSettingIcons !== undefined) {
        uiStore.setShowSettingIcons(ui.showSettingIcons);
      }
      if (ui.simpleMode !== undefined) {
        uiStore.setSimpleMode(ui.simpleMode);
      }
      if (ui.lowAnimationMode !== undefined) {
        uiStore.setLowAnimationMode(ui.lowAnimationMode);
      }
      if (ui.settingsIconPreset !== undefined) {
        uiStore.setSettingsIconPreset(ui.settingsIconPreset as any);
      }
      if (ui.sidebarWidth !== undefined) {
        uiStore.setSidebarWidth(ui.sidebarWidth as any);
      }
      if (ui.collapseChatSidebar !== undefined) {
        uiStore.setCollapseChatSidebar(ui.collapseChatSidebar);
      }
      if (ui.sidebarIconSize !== undefined) {
        uiStore.setSidebarIconSize(ui.sidebarIconSize as any);
      }
      if (ui.timezone !== undefined) {
        uiStore.setTimezone(ui.timezone);
      }
      if (ui.cmdPaletteEnabled !== undefined) {
        uiStore.setCmdPaletteEnabled(ui.cmdPaletteEnabled);
      }
      if (ui.cmdPaletteShortcut !== undefined) {
        uiStore.setCmdPaletteShortcut(ui.cmdPaletteShortcut);
      }
      if (ui.showCloseConfirmation !== undefined) {
        uiStore.setShowCloseConfirmation(ui.showCloseConfirmation);
      }
      if (ui.charFadeIntensity !== undefined) {
        uiStore.setCharFadeIntensity(ui.charFadeIntensity as any);
      }
      if (ui.windowSizePreset !== undefined) {
        uiStore.setWindowSizePreset(ui.windowSizePreset as any);
      }
      if (ui.glassTheme !== undefined) {
        uiStore.setGlassTheme(ui.glassTheme);
      }
      if (ui.nightBrightness !== undefined) {
        uiStore.setNightBrightness(ui.nightBrightness);
      }
    }
    
    // 应用 Markdown 设置
    if (markdown) {
      const mdStore = useMarkdownPreferences.getState();
      
      if (markdown.fontSize !== undefined) {
        mdStore.setFontSize(markdown.fontSize as any);
      }
    }
  }

  /**
   * 将本地格式转换为同步文档格式
   */
  toSyncDoc(item: SettingsSyncItem): SettingsSyncDoc {
    return {
      id: item.id,
      ui: item.ui,
      markdown: item.markdown,
      updated_at: item.updated_at,
      deleted_at: item.deleted_at ?? null,
      updated_by_device_id: item.updated_by_device_id ?? null,
    };
  }

  /**
   * 将同步文档格式转换为本地格式
   */
  fromSyncDoc(doc: SettingsSyncDoc): SettingsSyncItem {
    return {
      id: doc.id,
      ui: doc.ui,
      markdown: doc.markdown,
      updated_at: doc.updated_at,
      deleted_at: doc.deleted_at ?? null,
      updated_by_device_id: doc.updated_by_device_id ?? null,
    };
  }

  /**
   * 提取元数据
   */
  extractMetadata(item: SettingsSyncItem, deviceId: string): SyncMetadataEntry {
    return {
      updated_at: item.updated_at,
      deleted_at: item.deleted_at ?? null,
      device_id: item.updated_by_device_id ?? deviceId,
    };
  }

  /**
   * 同步完成后不需要额外操作
   * 各个 Store 的 setter 已经处理了持久化
   */
  async onSyncComplete(): Promise<void> {
    // 设置已通过 setter 自动持久化
  }
}

/**
 * 创建 Settings 适配器实例
 */
export function createSettingsAdapter(): SettingsAdapter {
  return new SettingsAdapter();
}
