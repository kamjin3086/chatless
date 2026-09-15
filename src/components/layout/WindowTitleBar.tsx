'use client';

import { useCallback, useEffect, useState } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { APP_INFO } from '@/config/app-info';
import { isTauriEnvironment } from '@/lib/utils/environment';
import { windowControlsOnLeft } from '@/lib/window/windowControls';
import { useLocaleStore } from '@/store/localeStore';

function RestoreIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" className={className} aria-hidden="true">
      <path
        d="M3.5 4.5h6v6h-6zM2.5 3.5V2h7.5v7.5H8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.15"
      />
    </svg>
  );
}

function TitleBarBrand() {
  return (
    <div className="window-titlebar-brand" data-tauri-drag-region>
      <img
        src="/logo.svg"
        alt=""
        width={22}
        height={15}
        draggable={false}
        className="window-titlebar-logo"
      />
      <span className="window-titlebar-name">{APP_INFO.name}</span>
    </div>
  );
}

export function WindowTitleBar() {
  const { t } = useLocaleStore();
  const [active, setActive] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [onLeft, setOnLeft] = useState(false);

  useEffect(() => {
    if (!isTauriEnvironment()) return;

    document.documentElement.classList.add('custom-titlebar');

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const { platform } = await import('@tauri-apps/plugin-os');
        if (cancelled) return;

        const win = getCurrentWindow();
        try {
          await win.setDecorations(false);
        } catch {
          // ACL / older runtime: Rust setup still forces this off.
        }

        const left = windowControlsOnLeft(platform());
        setOnLeft(left);
        document.documentElement.classList.toggle('custom-titlebar-left', left);
        document.documentElement.classList.toggle('custom-titlebar-right', !left);
        setMaximized(await win.isMaximized());
        if (cancelled) return;
        setActive(true);

        unlisten = await win.onResized(async () => {
          setMaximized(await win.isMaximized());
        });
        if (cancelled) unlisten?.();
      } catch (error) {
        console.warn('窗口标题栏初始化失败:', error);
        if (!cancelled) setActive(true);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const run = useCallback(async (op: 'minimize' | 'toggleMaximize' | 'close') => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      if (op === 'minimize') await win.minimize();
      else if (op === 'toggleMaximize') await win.toggleMaximize();
      else await win.close();
    } catch (error) {
      console.warn('窗口操作失败:', error);
    }
  }, []);

  if (!active) return null;

  const controls = (
    <div
      className={cn(
        'window-controls flex items-center h-full',
        onLeft ? 'window-controls-mac' : 'window-controls-win'
      )}
    >
      {onLeft ? (
        <>
          <button
            type="button"
            className="window-btn window-btn-mac window-btn-close"
            title={t('window.close')}
            aria-label={t('window.close')}
            onClick={() => void run('close')}
          />
          <button
            type="button"
            className="window-btn window-btn-mac window-btn-min"
            title={t('window.minimize')}
            aria-label={t('window.minimize')}
            onClick={() => void run('minimize')}
          />
          <button
            type="button"
            className="window-btn window-btn-mac window-btn-max"
            title={maximized ? t('window.restore') : t('window.maximize')}
            aria-label={maximized ? t('window.restore') : t('window.maximize')}
            onClick={() => void run('toggleMaximize')}
          />
        </>
      ) : (
        <>
          <button
            type="button"
            className="window-btn window-btn-win"
            title={t('window.minimize')}
            aria-label={t('window.minimize')}
            onClick={() => void run('minimize')}
          >
            <Minus className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="window-btn window-btn-win"
            title={maximized ? t('window.restore') : t('window.maximize')}
            aria-label={maximized ? t('window.restore') : t('window.maximize')}
            onClick={() => void run('toggleMaximize')}
          >
            {maximized ? (
              <RestoreIcon className="w-2.5 h-2.5" />
            ) : (
              <Square className="w-[13px] h-[13px]" strokeWidth={1.75} />
            )}
          </button>
          <button
            type="button"
            className="window-btn window-btn-win window-btn-close"
            title={t('window.close')}
            aria-label={t('window.close')}
            onClick={() => void run('close')}
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        </>
      )}
    </div>
  );

  return (
    <header className="window-titlebar">
      <div className="window-titlebar-slot window-titlebar-slot-start">
        {onLeft ? controls : <TitleBarBrand />}
      </div>
      <div className="window-titlebar-drag" data-tauri-drag-region />
      <div className="window-titlebar-slot window-titlebar-slot-end">
        {onLeft ? <TitleBarBrand /> : controls}
      </div>
    </header>
  );
}
