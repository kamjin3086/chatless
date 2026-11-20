'use client';

import { useEffect, useState } from 'react';

export function AppRecoveryView() {
  const [isDesktop, setIsDesktop] = useState(false);
  const [closeFailed, setCloseFailed] = useState(false);
  const [chinese, setChinese] = useState(false);

  useEffect(() => {
    const language = document.documentElement.lang || navigator.language;
    setChinese(/^zh\b/i.test(language));
    if (!('__TAURI_INTERNALS__' in window)) return;
    setIsDesktop(true);
    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().setDecorations(true))
      .catch((error) =>
        console.warn(
          '[AppRecovery] Could not restore native window controls',
          error,
        ),
      );
  }, []);

  async function closeWindow() {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } catch (error) {
      console.error('[AppRecovery] Could not close window', error);
      setCloseFailed(true);
    }
  }

  return (
    <main
      translate="no"
      style={{
        colorScheme: 'light dark',
        background: 'Canvas',
        color: 'CanvasText',
        minHeight: '100vh',
        boxSizing: 'border-box',
        display: 'grid',
        placeItems: 'center',
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <section style={{ maxWidth: '30rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.5rem' }}>
          {chinese ? 'Chatless 遇到了错误' : 'Chatless ran into an error'}
        </h1>
        <p style={{ margin: '0 0 1rem' }}>
          {chinese
            ? '可以重新加载界面；如果问题仍然存在，请关闭窗口后重新打开 Chatless。'
            : 'Reload the interface. If the problem persists, close the window and reopen Chatless.'}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ font: 'inherit', padding: '0.4rem 0.75rem' }}
          >
            {chinese ? '重新加载' : 'Reload'}
          </button>
          {isDesktop && (
            <button
              type="button"
              onClick={() => void closeWindow()}
              style={{ font: 'inherit', padding: '0.4rem 0.75rem' }}
            >
              {chinese ? '关闭窗口' : 'Close window'}
            </button>
          )}
        </div>
        {closeFailed && (
          <p role="status">
            {chinese
              ? '无法从这里关闭窗口，请使用系统窗口菜单或任务管理器。'
              : 'Could not close the window here. Use your system window menu or task manager.'}
          </p>
        )}
      </section>
    </main>
  );
}
