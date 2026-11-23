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
import { useTranslation } from '@/i18n/useTranslation';
import { useLocaleStore } from '@/store/localeStore';
import type { Locale } from '@/i18n/types';
import { THEME_KEY } from '@/lib/preferences/keys';


export function GeneralSettings() {
  const [theme, setTheme] = useState<string>("system");
  const [initialized, setInitialized] = useState(false);
  const locale = useLocaleStore((state) => state.locale);
  const setLocale = useLocaleStore((state) => state.setLocale);
  const t = useTranslation();
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
        <SettingsSectionHeader icon={SlidersHorizontal} title={t('settings.general.basicOptions')} />
        <div className="space-y-2">
          <SelectField
            label={t('settings.general.language')}
            options={[
              { value: "zh", label: t('settings.general.language.zh') },
              { value: "en", label: t('settings.general.language.en') },
            ]}
            value={locale}
            onChange={(v) => setLocale(v as Locale)}
          />
          <SelectField
            label={t('settings.general.theme')}
            options={[
              { value: "system", label: t('settings.general.theme.system') },
              { value: "light", label: t('settings.general.theme.light') },
              { value: "dark", label: t('settings.general.theme.dark') },
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
            tooltip={t('settings.general.nightBrightness.help')}
          />
        </div>
      </SettingsCard>

      {/* 聊天显示 */}
      <SettingsCard>
        <SettingsSectionHeader icon={MessageSquare} title={t('settings.general.chatDisplay')} />
        <div className="space-y-2">
          <ToggleSwitch
            label={t('settings.general.collapseChatSidebar')}
            checked={ui.collapseChatSidebar}
            onChange={ui.setCollapseChatSidebar}
          />
          <SelectField
            label={t('settings.general.chatFontSize')}
            options={[
              { value: "small", label: t('settings.general.fontSize.small') },
              { value: "medium", label: t('settings.general.fontSize.medium') },
              { value: "large", label: t('settings.general.fontSize.large') },
            ]}
            value={chatFontSize}
            onChange={(v) => setChatFontSize(v as any)}
          />
          <SelectField
            label={t('settings.general.charFadeIntensity')}
            options={[
              { value: 'off', label: t('settings.general.charFadeIntensity.off') },
              { value: 'light', label: t('settings.general.charFadeIntensity.light') },
              { value: 'normal', label: t('settings.general.charFadeIntensity.normal') },
              { value: 'strong', label: t('settings.general.charFadeIntensity.strong') },
            ]}
            value={ui.charFadeIntensity as string}
            onChange={(v) => ui.setCharFadeIntensity(v as any)}
          />
        </div>
      </SettingsCard>

      {/* 界面显示 */}
      <SettingsCard>
        <SettingsSectionHeader icon={Monitor} title={t('settings.general.interfaceDisplay')} />
        <div className="space-y-2">
          <SelectField
            label={t('settings.general.interfaceTextSize')}
            options={[
              { value: "small", label: t('settings.general.fontSize.small') },
              { value: "medium", label: t('settings.general.fontSize.medium') },
              { value: "large", label: t('settings.general.fontSize.large') },
            ]}
            value={globalFontSize}
            onChange={(v) => setGlobalFontSize(v as any)}
          />
          <ToggleSwitch
            label={t('settings.general.closeConfirm')}
            checked={ui.showCloseConfirmation}
            onChange={(v) => ui.setShowCloseConfirmation(v)}
          />
          <ToggleSwitch
            label={t('settings.general.closeToTray')}
            checked={ui.closeToTray}
            onChange={ui.setCloseToTray}
          />
          <ToggleSwitch
            label={t('settings.general.commandPalette')}
            checked={ui.cmdPaletteEnabled}
            onChange={(v) => ui.setCmdPaletteEnabled(v)}
            tooltip={t('settings.general.commandPalette.help')}
          />
          {ui.cmdPaletteEnabled && (
            <ShortcutField
              label={t('settings.general.shortcut')}
              value={ui.cmdPaletteShortcut}
              onChange={ui.setCmdPaletteShortcut}
              tooltip={t('settings.general.shortcut.help')}
            />
          )}
        </div>
      </SettingsCard>

      {/* 个性化设置 */}
      <PersonalizationSettings />
    </div>
  );
}
