"use client";

import { useEffect, useRef, useState } from 'react';
import { Palette } from 'lucide-react';
import { ToggleSwitch } from "./ToggleSwitch";
import { SelectField } from "./SelectField";
import { useUiPreferences } from "@/store/uiPreferences";
import { useLocaleStore } from '@/store/localeStore';
import { toast } from "@/components/ui/sonner";
import {
  clearGlassWallpaperFile,
  isWallpaperDataUrl,
  loadGlassWallpaperUrl,
  saveGlassWallpaper,
  WallpaperSaveError,
} from "@/lib/glass/wallpaper";
import {
  applyWindowSizePreset,
  readWindowWorkArea,
  type WindowSize,
} from "@/lib/window/windowFit";

function formatWindowDimensions({ width, height }: WindowSize): string {
  return `${Math.round(width)} × ${Math.round(height)}`;
}

export function PersonalizationSettings() {
  const ui = useUiPreferences();
  const { t } = useLocaleStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // Logical pixels the desktop actually offers; null outside the desktop app.
  const [workArea, setWorkArea] = useState<WindowSize | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readWindowWorkArea().then((area) => {
      if (!cancelled) setWorkArea(area);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;

    const run = async () => {
      if (!ui.glassWallpaperFile) {
        setPreviewUrl(null);
        return;
      }
      if (isWallpaperDataUrl(ui.glassWallpaperFile)) {
        setPreviewUrl(ui.glassWallpaperFile);
        return;
      }
      const url = await loadGlassWallpaperUrl(ui.glassWallpaperFile);
      if (cancelled) {
        if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
        return;
      }
      createdUrl = url && url.startsWith('blob:') ? url : null;
      setPreviewUrl(url);
    };

    void run();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [ui.glassWallpaperFile]);

  const handlePickWallpaper = async (file: File | undefined) => {
    if (!file) return;
    setPicking(true);
    try {
      const stored = await saveGlassWallpaper(file);
      ui.setGlassWallpaperFile(stored);
      if (!ui.glassTheme) ui.setGlassTheme(true);
      toast.success(t('settings.personalization.wallpaper.updated'));
    } catch (err) {
      if (err instanceof WallpaperSaveError) {
        toast.error(t(`settings.personalization.wallpaper.error.${err.reason}`));
      } else {
        console.warn('Failed to save wallpaper:', err);
        toast.error(t('settings.personalization.wallpaper.error.saveFailed'));
      }
    } finally {
      setPicking(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleClearWallpaper = async () => {
    await clearGlassWallpaperFile(ui.glassWallpaperFile);
    ui.setGlassWallpaperFile(null);
  };

  return (
    <div className="settings-card border border-slate-100 dark:border-slate-800 rounded-lg p-6 space-y-6 bg-white dark:bg-slate-900/50 shadow-sm">
      {/* 头部 */}
      <div className="flex items-center gap-3 pb-4 border-b border-slate-50 dark:border-slate-800">
        <Palette className="w-5 h-5 text-slate-600 dark:text-slate-400" />
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">
          {t('settings.personalization.title')}
        </h3>
      </div>

             {/* 设置内容 */}
       <div className="space-y-6">
         <ToggleSwitch
           label={t('settings.personalization.simpleMode')}
           checked={ui.simpleMode}
           onChange={ui.setSimpleMode}
           tooltip={t('settings.personalization.simpleModeHelp')}
         />

         <ToggleSwitch
           label={t('settings.personalization.lowAnimationMode')}
           checked={ui.lowAnimationMode}
           onChange={ui.setLowAnimationMode}
           tooltip={t('settings.personalization.lowAnimationModeHelp')}
         />

         <ToggleSwitch
           label={t('settings.personalization.glassTheme')}
           checked={ui.glassTheme}
           onChange={ui.setGlassTheme}
           tooltip={t('settings.personalization.glassThemeHelp')}
         />

         {ui.glassTheme && (
           <div className="flex items-center justify-between gap-4 py-1">
             <div className="flex items-center gap-3 min-w-0">
               <div className="w-14 h-9 rounded-md overflow-hidden border border-slate-200/70 dark:border-slate-700/60 bg-slate-100 dark:bg-slate-800 flex-shrink-0">
                 {previewUrl ? (
                   // eslint-disable-next-line @next/next/no-img-element
                   <img src={previewUrl} alt="" className="w-full h-full object-cover" />
                 ) : (
                   <div className="w-full h-full bg-slate-200 dark:bg-slate-800" />
                 )}
               </div>
               <div className="min-w-0">
                 <div className="text-xs text-slate-700 dark:text-slate-300">
                   {t('settings.personalization.wallpaper.label')}
                 </div>
                 <div className="text-[10px] text-slate-400">
                   {t('settings.personalization.wallpaper.help')}
                 </div>
               </div>
             </div>
             <div className="flex items-center gap-2 flex-shrink-0">
               <input
                 ref={fileInputRef}
                 type="file"
                 accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
                 className="hidden"
                 onChange={(e) => void handlePickWallpaper(e.target.files?.[0])}
               />
               <button
                 type="button"
                 disabled={picking}
                 onClick={() => fileInputRef.current?.click()}
                 className="h-7 px-2 text-xs rounded-md border border-slate-200/70 dark:border-slate-700/50 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
               >
                 {picking
                   ? t('settings.personalization.wallpaper.processing')
                   : t('settings.personalization.wallpaper.chooseImage')}
               </button>
               {ui.glassWallpaperFile && (
                 <button
                   type="button"
                   onClick={() => void handleClearWallpaper()}
                   className="h-7 px-2 text-xs rounded-md text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
                 >
                   {t('settings.personalization.wallpaper.clear')}
                 </button>
               )}
             </div>
           </div>
         )}

         <ToggleSwitch
           label={t('settings.personalization.showSettingIcons')}
           checked={ui.showSettingIcons}
           onChange={ui.setShowSettingIcons}
         />

        <div>
          <SelectField
            label={t('settings.personalization.windowSize')}
            options={[
              { value: '900x700', label: '900 × 700' },
              {
                value: '1024x768',
                label: t('settings.personalization.windowSize.default').replace('{0}', '1024 × 768'),
              },
              { value: '1280x800', label: '1280 × 800' },
              { value: '1366x768', label: '1366 × 768' },
              { value: '1440x900', label: '1440 × 900' },
              { value: '1600x900', label: '1600 × 900' },
            ]}
            value={ui.windowSizePreset as any}
            onChange={async (v) => {
              ui.setWindowSizePreset(v as any);
              try {
                const applied = await applyWindowSizePreset(v);
                if (!applied) return;
                setWorkArea(applied.workArea);
                const { savePersistedWindowState } = await import('@/lib/window/windowState');
                await savePersistedWindowState();
                if (applied.reduced) {
                  toast.info(
                    t('settings.personalization.windowSize.reduced')
                      .replace('{0}', formatWindowDimensions(applied.workArea))
                      .replace('{1}', formatWindowDimensions(applied.applied)),
                  );
                }
              } catch (err) {
                console.warn('设置窗口尺寸失败:', err);
              }
            }}
          />
          {workArea && (
            <div className="text-[10px] text-slate-400 text-right mt-0.5">
              {t('settings.personalization.windowSize.workArea').replace('{0}', formatWindowDimensions(workArea))}
            </div>
          )}
        </div>

        <SelectField
           label={t('settings.personalization.sidebarWidth')}
           options={[
             { value: 'narrow', label: t('settings.personalization.sidebarWidth.narrow') },
             { value: 'medium', label: t('settings.personalization.sidebarWidth.medium') },
             { value: 'wide', label: t('settings.personalization.sidebarWidth.wide') },
             { value: 'xwide', label: t('settings.personalization.sidebarWidth.xwide') },
           ]}
           value={ui.sidebarWidth}
           onChange={(v) => ui.setSidebarWidth(v as any)}
         />

         <SelectField
           label={t('settings.personalization.sidebarIconSize')}
           options={[
             { value: 'small', label: t('settings.personalization.sidebarIconSize.small') },
             { value: 'medium', label: t('settings.personalization.sidebarIconSize.medium') },
             { value: 'large', label: t('settings.personalization.sidebarIconSize.large') },
           ]}
           value={ui.sidebarIconSize}
           onChange={(v) => ui.setSidebarIconSize(v as any)}
         />

         <SelectField
           label={t('settings.personalization.timezone')}
           options={[
             { value: 'local', label: t('settings.personalization.timezone.local') },
             { value: 'UTC', label: 'UTC' },
             { value: 'UTC+8', label: 'UTC+8' },
             { value: 'America/New_York', label: t('settings.personalization.timezone.newYork') },
             { value: 'Europe/London', label: t('settings.personalization.timezone.london') },
             { value: 'Asia/Tokyo', label: t('settings.personalization.timezone.tokyo') },
           ]}
           value={ui.timezone}
           onChange={ui.setTimezone}
         />

        {/* <SelectField
          label="逐字淡入强度"
          options={[
            { value: 'off', label: '关闭' },
            { value: 'light', label: '轻' },
            { value: 'normal', label: '中（默认）' },
            { value: 'strong', label: '重' },
          ]}
          value={ui.charFadeIntensity as any}
          onChange={(v) => ui.setCharFadeIntensity(v as any)}
        /> */}

        {/* <SelectField
          label="设置页图标样式"
          options={[
            { value: 'brand', label: '品牌渐变' },
            { value: 'teal', label: '绿色渐变' },
            { value: 'indigo', label: '靛蓝渐变' },
            { value: 'gray', label: '中性灰底' },
            { value: 'glass', label: '玻璃质感' },
            { value: 'outline', label: '细边框' },
          ]}
          value={ui.settingsIconPreset as SectionIconPreset}
          onChange={(v) => ui.setSettingsIconPreset(v as SectionIconPreset)}
        /> */}
       </div>
    </div>
  );
}
