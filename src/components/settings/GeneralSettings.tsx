"use client";

import { useState, useEffect } from "react";
import { SelectField } from "./SelectField";
import { ToggleSwitch } from './ToggleSwitch';
import { ShortcutField } from './ShortcutField';
import { SettingsCard, SettingsPageHeader } from "./SettingsCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { PersonalizationSettings } from "./PersonalizationSettings";
import { SlidersHorizontal, Monitor, MessageSquare } from "lucide-react";
import StorageUtil from "@/lib/storage";
import { useMarkdownFontSize } from "@/hooks/useMarkdownFontSize";
import { useGlobalFontSize } from "@/hooks/useGlobalFontSize";
import { useUiPreferences } from '@/store/uiPreferences';
import { ThemeInitializer } from "@/lib/utils/themeInitializer";

const THEME_KEY = "app_theme";
const LANG_KEY = "app_lang";

export function GeneralSettings() {
  const [theme, setTheme] = useState<string>("system");
  const [lang, setLang] = useState<string>("zh");
  const [initialized, setInitialized] = useState(false);
  const { size: chatFontSize, setSize: setChatFontSize } = useMarkdownFontSize();
  const { size: globalFontSize, setSize: setGlobalFontSize } = useGlobalFontSize();
  const ui = useUiPreferences();

  useEffect(() => {
    const loadSettings = async () => {
      const savedTheme = await StorageUtil.getItem<string>(THEME_KEY, "system");
      const savedLang = await StorageUtil.getItem<string>(LANG_KEY, "zh");
      setTheme(savedTheme || "system");
      setLang(savedLang || "zh");
      setInitialized(true);
    };
    loadSettings();
  }, []);

  useEffect(() => {
    if (!initialized || typeof document === "undefined") return;
    ThemeInitializer.syncThemeToStorage(theme);
    ThemeInitializer.applyTheme(theme);
  }, [theme, initialized]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    StorageUtil.setItem(LANG_KEY, lang);
  }, [lang]);

  return (
    <div className="space-y-4">
      <SettingsPageHeader 
        title="常规设置" 
        description="界面语言、主题模式、字体大小等基础设置。"
      />

      {/* 基础设置 */}
      <SettingsCard>
        <SettingsSectionHeader icon={SlidersHorizontal} title="基础选项" />
        <div className="space-y-2">
          <SelectField
            label="界面语言"
            options={[
              { value: "zh", label: "简体中文" },
              { value: "en", label: "English" },
            ]}
            value={lang}
            onChange={setLang}
          />
          <SelectField
            label="主题模式"
            options={[
              { value: "system", label: "跟随系统" },
              { value: "light", label: "亮色" },
              { value: "dark", label: "暗色" },
            ]}
            value={theme}
            onChange={setTheme}
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
            label="关闭时显示确认"
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
