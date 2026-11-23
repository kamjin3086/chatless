'use client';

import React, { useEffect, useState } from 'react';
import { getHtmlLang, translate } from '@/i18n';
import type { Locale } from '@/i18n/types';

export function getAppRecoveryLocale(
  documentLanguage?: string,
  browserLanguage?: string,
): Locale {
  return /^zh(?:-|$)/i.test(documentLanguage || browserLanguage || '')
    ? 'zh'
    : 'en';
}

export function AppRecoveryView() {
  const [isDesktop, setIsDesktop] = useState(false);
  const [closeFailed, setCloseFailed] = useState(false);
  const [locale, setLocale] = useState<Locale>('en');

  useEffect(() => {
    // This view must still work if the root layout or storage failed to start.
    setLocale(
      getAppRecoveryLocale(document.documentElement.lang, navigator.language),
    );
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
      lang={getHtmlLang(locale)}
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
          {translate(locale, 'error.recovery.title')}
        </h1>
        <p style={{ margin: '0 0 1rem' }}>
          {translate(locale, 'error.recovery.description')}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ font: 'inherit', padding: '0.4rem 0.75rem' }}
          >
            {translate(locale, 'error.recovery.reload')}
          </button>
          {isDesktop && (
            <button
              type="button"
              onClick={() => void closeWindow()}
              style={{ font: 'inherit', padding: '0.4rem 0.75rem' }}
            >
              {translate(locale, 'error.recovery.closeWindow')}
            </button>
          )}
        </div>
        {closeFailed && (
          <p role="status">{translate(locale, 'error.recovery.closeFailed')}</p>
        )}
      </section>
    </main>
  );
}
