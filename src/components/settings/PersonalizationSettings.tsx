"use client";

import { useEffect, useRef, useState } from 'react';
import { Palette } from 'lucide-react';
import { ToggleSwitch } from "./ToggleSwitch";
import { SelectField } from "./SelectField";
import { useUiPreferences } from "@/store/uiPreferences";
import { toast } from "@/components/ui/sonner";
import {
  clearGlassWallpaperFile,
  isWallpaperDataUrl,
  loadGlassWallpaperUrl,
  saveGlassWallpaper,
} from "@/lib/glass/wallpaper";

export function PersonalizationSettings() {
  const ui = useUiPreferences();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

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
      toast.success('壁纸已更新');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '设置壁纸失败';
      toast.error(msg);
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
    <div className="settings-card border border-slate-100 dark:border-slate-800 rounded-2xl p-6 space-y-6 bg-white dark:bg-slate-900/50 shadow-sm">
      {/* 头部 */}
      <div className="flex items-center gap-3 pb-4 border-b border-slate-50 dark:border-slate-800">
        <Palette className="w-5 h-5 text-slate-600 dark:text-slate-400" />
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">外观与体验</h3>
      </div>

             {/* 设置内容 */}
       <div className="space-y-6">
         <ToggleSwitch
           label="简洁模式"
           checked={ui.simpleMode}
           onChange={ui.setSimpleMode}
           tooltip="弱化颜色、阴影和装饰元素，提供更简洁的界面"
         />

         <ToggleSwitch
           label="低动画模式"
           checked={ui.lowAnimationMode}
           onChange={ui.setLowAnimationMode}
           tooltip="减少过渡动画和淡入淡出效果，适合性能较弱的设备"
         />

         <ToggleSwitch
           label="玻璃主题"
           checked={ui.glassTheme}
           onChange={ui.setGlassTheme}
           tooltip="半透明毛玻璃面板。搭配壁纸时效果最接近沉浸式对话界面，可随时关闭"
         />

         {ui.glassTheme && (
           <div className="flex items-center justify-between gap-4 py-1">
             <div className="flex items-center gap-3 min-w-0">
               <div className="w-14 h-9 rounded-md overflow-hidden border border-slate-200/70 dark:border-slate-700/60 bg-slate-100 dark:bg-slate-800 flex-shrink-0">
                 {previewUrl ? (
                   // eslint-disable-next-line @next/next/no-img-element
                   <img src={previewUrl} alt="" className="w-full h-full object-cover" />
                 ) : (
                   <div className="w-full h-full glass-wallpaper-fallback" />
                 )}
               </div>
               <div className="min-w-0">
                 <div className="text-xs text-slate-700 dark:text-slate-300">聊天壁纸</div>
                 <div className="text-[10px] text-slate-400">可选。不设壁纸时使用内置渐变</div>
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
                 {picking ? '处理中…' : '选择图片'}
               </button>
               {ui.glassWallpaperFile && (
                 <button
                   type="button"
                   onClick={() => void handleClearWallpaper()}
                   className="h-7 px-2 text-xs rounded-md text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
                 >
                   清除
                 </button>
               )}
             </div>
           </div>
         )}

         <ToggleSwitch
           label="显示设置页图标"
           checked={ui.showSettingIcons}
           onChange={ui.setShowSettingIcons}
         />

        <SelectField
          label="应用窗口尺寸"
          options={[
            { value: '900x700', label: '900 × 700' },
            { value: '1024x768', label: '1024 × 768（默认）' },
            { value: '1280x800', label: '1280 × 800' },
            { value: '1366x768', label: '1366 × 768' },
            { value: '1440x900', label: '1440 × 900' },
            { value: '1600x900', label: '1600 × 900' },
          ]}
          value={ui.windowSizePreset as any}
          onChange={async (v) => {
            ui.setWindowSizePreset(v as any);
            const [w,h] = String(v).split('x').map((n)=>parseInt(n,10));
            if (Number.isFinite(w) && Number.isFinite(h)) {
              try {
                const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window');
                const win = getCurrentWindow();
                await win.setSize(new LogicalSize(w, h));
                const { savePersistedWindowState } = await import('@/lib/window/windowState');
                await savePersistedWindowState();
              } catch (err) {
                console.warn('设置窗口尺寸失败:', err);
              }
            }
          }}
        />

        <SelectField
           label="主侧边栏宽度"
           options={[
             { value: 'narrow', label: '窄' },
             { value: 'medium', label: '中' },
             { value: 'wide', label: '宽' },
             { value: 'xwide', label: '超宽' },
           ]}
           value={ui.sidebarWidth}
           onChange={(v) => ui.setSidebarWidth(v as any)}
         />

         <SelectField
           label="侧边栏图标大小"
           options={[
             { value: 'small', label: '小' },
             { value: 'medium', label: '中' },
             { value: 'large', label: '大' },
           ]}
           value={ui.sidebarIconSize}
           onChange={(v) => ui.setSidebarIconSize(v as any)}
         />

      

         <SelectField
           label="显示时间时区"
           options={[
             { value: 'local', label: '本地时区' },
             { value: 'UTC', label: 'UTC' },
             { value: 'UTC+8', label: 'UTC+8' },
             { value: 'America/New_York', label: '纽约 (UTC-4/5)' },
             { value: 'Europe/London', label: '伦敦 (UTC+0)' },
             { value: 'Asia/Tokyo', label: '东京 (UTC+9)' },
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
