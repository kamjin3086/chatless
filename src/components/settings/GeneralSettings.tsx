"use client";

import { useState, useEffect } from "react";
import { SelectField } from "./SelectField";
import { ToggleSwitch } from './ToggleSwitch';
import { ShortcutField } from './ShortcutField';
import { SliderField } from './SliderField';
import { SettingsCard, SettingsPageHeader } from "./SettingsCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { PersonalizationSettings } from "./PersonalizationSettings";
import { SlidersHorizontal, Monitor, MessageSquare } from "lucide-react";
import { useMarkdownFontSize } from "@/hooks/useMarkdownFontSize";
import { useGlobalFontSize } from "@/hooks/useGlobalFontSize";
import { useUiPreferences } from '@/store/uiPreferences';
import { ThemeInitializer } from "@/lib/utils/themeInitializer";
import { useLocaleStore } from '@/store/localeStore';
import type { Locale } from '@/i18n/types';

const THEME_KEY = "app_theme";

export function GeneralSettings() {
  const [theme, setTheme] = useState<string>("system");
  const [initialized, setInitialized] = useState(false);
  const { locale, setLocale, t } = useLocaleStore();
  const { size: chatFontSize, setSize: setChatFontSize } = useMarkdownFontSize();
  const { size: globalFontSize, setSize: setGlobalFontSize } = useGlobalFontSize();
  const ui = useUiPreferences();

  useEffect(() => {
    const loadSettings = async () => {
      const { default: StorageUtil } = await import('@/lib/storage');
      const savedTheme = await StorageUtil.getItem<string>(THEME_KEY, "system");
      setTheme(savedTheme || "system");
      setInitialized(true);
    };
    loadSettings();
  }, []);

  useEffect(() => {
    if (!initialized || typeof document === "undefined") return;
    ThemeInitializer.syncThemeToStorage(theme);
    ThemeInitializer.applyTheme(theme);
    void import('@/lib/storage').then(({ default: StorageUtil }) => {
      StorageUtil.setItem(THEME_KEY, theme);
    });
  }, [theme, initialized]);

  return (
    <div className="space-y-4">
      <SettingsPageHeader 
        title={t('settings.general.title')} 
        description={t('settings.general.description')}
      />

      {/* 基础设置 */}
      <SettingsCard>
        <SettingsSectionHeader icon={SlidersHorizontal} title="基础选项" />
        <div className="space-y-2">
          <SelectField
            label={t('settings.general.language')}
            options={[
              { value: "zh", label: "简体中文" },
              { value: "en", label: "English" },
            ]}
            value={locale}
            onChange={(v) => setLocale(v as Locale)}
          />
          <SelectField
            label={t('settings.general.theme')}
            options={[
              { value: "system", label: "跟随系统" },
              { value: "light", label: "亮色" },
              { value: "dark", label: "暗色" },
            ]}
            value={theme}
            onChange={setTheme}
          />
          <SliderField
            label={t('settings.general.nightBrightness')}
            value={ui.nightBrightness}
            onChange={ui.setNightBrightness}
            min={50}
            max={100}
            step={1}
            valueLabel={`${ui.nightBrightness}%`}
            tooltip="仅暗色模式生效。100% 为当前默认亮度，调低可减轻夜间刺眼"
          />
        </div>
      </SettingsCard>

      {/* 聊天显示 */}
      <SettingsCard>
        <SettingsSectionHeader icon={MessageSquare} title="聊天显示" />
        <div className="space-y-2">
          <ToggleSwitch
            label="默认折叠聊天侧边栏"
            checked={ui.collapseChatSidebar}
            onChange={ui.setCollapseChatSidebar}
          />
          <SelectField
            label="聊天字体大小"
            options={[
              { value: "small", label: "小" },
              { value: "medium", label: "中" },
              { value: "large", label: "大" },
            ]}
            value={chatFontSize}
            onChange={(v) => setChatFontSize(v as any)}
          />
          <SelectField
            label="逐字淡入强度"
            options={[
              { value: 'off', label: '关闭' },
              { value: 'light', label: '轻' },
              { value: 'normal', label: '中' },
              { value: 'strong', label: '重' },
            ]}
            value={ui.charFadeIntensity as string}
            onChange={(v) => ui.setCharFadeIntensity(v as any)}
          />
        </div>
      </SettingsCard>

      {/* 界面显示 */}
      <SettingsCard>
        <SettingsSectionHeader icon={Monitor} title="界面显示" />
        <div className="space-y-2">
          <SelectField
            label="界面文本大小"
            options={[
              { value: "small", label: "小" },
              { value: "medium", label: "中" },
              { value: "large", label: "大" },
            ]}
            value={globalFontSize}
            onChange={(v) => setGlobalFontSize(v as any)}
          />
          <ToggleSwitch
            label={t('settings.general.minimizeToTray')}
            checked={ui.minimizeToTray}
            onChange={ui.setMinimizeToTray}
          />
          <ToggleSwitch
            label={t('settings.general.closeConfirm')}
            checked={ui.showCloseConfirmation}
            onChange={(v) => ui.setShowCloseConfirmation(v)}
          />
          <ToggleSwitch
            label="启用快捷指令面板"
            checked={ui.cmdPaletteEnabled}
            onChange={(v) => ui.setCmdPaletteEnabled(v)}
            tooltip="使用快捷键快速搜索和执行操作"
          />
          {ui.cmdPaletteEnabled && (
            <ShortcutField
              label="快捷键"
              value={ui.cmdPaletteShortcut}
              onChange={ui.setCmdPaletteShortcut}
              tooltip="点击后按下组合键设置"
            />
          )}
        </div>
      </SettingsCard>

      {/* 个性化设置 */}
      <PersonalizationSettings />
    </div>
  );
}
