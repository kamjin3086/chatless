import { createElement, useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = {
  getItem: vi.fn<(key: string, fallback: string) => Promise<string | null>>(),
  setItem: vi.fn<(key: string, locale: string) => Promise<boolean>>(),
};
vi.mock('@/lib/storage', () => ({ default: storage }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const documentElement = { lang: 'zh-CN' };
let saved: string | null;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  saved = null;
  documentElement.lang = 'zh-CN';
  vi.stubGlobal('document', { documentElement });
  storage.getItem.mockImplementation(
    async (_key, fallback) => saved ?? fallback,
  );
  storage.setItem.mockImplementation(async (_key, locale) => {
    saved = locale;
    return true;
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('localeStore', () => {
  it.each([
    { persisted: 'en', locale: 'en', lang: 'en-US', label: 'Chat' },
    { persisted: 'zh', locale: 'zh', lang: 'zh-CN', label: '聊天' },
    { persisted: null, locale: 'zh', lang: 'zh-CN', label: '聊天' },
    { persisted: 'invalid', locale: 'zh', lang: 'zh-CN', label: '聊天' },
  ])(
    'loads app_lang=$persisted with the matching document language',
    async ({ persisted, locale, lang, label }) => {
      saved = persisted;
      const { useLocaleStore } = await import('../localeStore');

      expect(storage.getItem).toHaveBeenCalledWith('app_lang', 'zh');
      expect(useLocaleStore.getState()).toMatchObject({
        locale,
        initialized: true,
      });
      expect(useLocaleStore.getState().t('nav.chat')).toBe(label);
      expect(documentElement.lang).toBe(lang);
      expect(storage.setItem).not.toHaveBeenCalled();
    },
  );

  it.each([
    { selected: 'zh', persisted: 'en', lang: 'zh-CN' },
    { selected: 'en', persisted: 'zh', lang: 'en-US' },
  ] as const)(
    'keeps an explicit choice of $selected over a late read of $persisted',
    async ({ selected, persisted, lang }) => {
      const startupRead = deferred<string>();
      storage.getItem.mockReturnValueOnce(startupRead.promise);
      const { useLocaleStore } = await import('../localeStore');
      expect(useLocaleStore.getState().initialized).toBe(false);

      useLocaleStore.getState().setLocale(selected);
      startupRead.resolve(persisted);
      await startupRead.promise;

      expect(useLocaleStore.getState()).toMatchObject({
        locale: selected,
        initialized: true,
      });
      expect(documentElement.lang).toBe(lang);
      expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(
        'app_lang',
        selected,
      );
    },
  );

  it('persists rapid selections in order so a reload sees the last choice', async () => {
    const firstSave = deferred<void>();
    storage.setItem.mockImplementationOnce(async (_key, locale) => {
      await firstSave.promise;
      saved = locale;
      return true;
    });
    const { useLocaleStore } = await import('../localeStore');
    const { setLocale } = useLocaleStore.getState();

    setLocale('zh');
    setLocale('en');
    expect(useLocaleStore.getState().locale).toBe('en');
    expect(documentElement.lang).toBe('en-US');
    await vi.waitFor(() =>
      expect(storage.setItem).toHaveBeenCalledExactlyOnceWith('app_lang', 'zh'),
    );

    firstSave.resolve();
    await vi.waitFor(() => expect(saved).toBe('en'));
    expect(storage.setItem.mock.calls).toEqual([
      ['app_lang', 'zh'],
      ['app_lang', 'en'],
    ]);

    documentElement.lang = 'zh-CN';
    vi.resetModules();
    const { useLocaleStore: reloadedStore } = await import('../localeStore');
    expect(reloadedStore.getState().locale).toBe('en');
    expect(documentElement.lang).toBe('en-US');
  });

  it('updates a mounted useTranslation subscriber after startup and selection', async () => {
    const startupRead = deferred<string>();
    storage.getItem.mockReturnValueOnce(startupRead.promise);
    const { useLocaleStore } = await import('../localeStore');
    const { useTranslation } = await import('@/i18n/useTranslation');
    const commits = vi.fn<(label: string) => void>();

    function Subscriber() {
      const t = useTranslation();
      const label = t('nav.chat');
      useLayoutEffect(() => commits(label), [label]);
      return null;
    }

    // The probe records committed text without rendering host elements. React only
    // needs a container and document for its delegated event listeners.
    const ownerDocument = Object.assign(new EventTarget(), { documentElement });
    vi.stubGlobal('document', ownerDocument);
    vi.stubGlobal('window', {
      document: ownerDocument,
      HTMLIFrameElement: class {},
    });
    const container = Object.assign(new EventTarget(), {
      nodeType: 1,
      tagName: 'DIV',
      ownerDocument,
    });
    const root = createRoot(container as unknown as HTMLElement);
    try {
      flushSync(() => root.render(createElement(Subscriber)));
      expect(commits).toHaveBeenCalledExactlyOnceWith('聊天');
      startupRead.resolve('en');
      await vi.waitFor(() => expect(commits).toHaveBeenLastCalledWith('Chat'));
      expect(documentElement.lang).toBe('en-US');

      flushSync(() => useLocaleStore.getState().setLocale('zh'));
      expect(documentElement.lang).toBe('zh-CN');
      expect(commits.mock.calls).toEqual([['聊天'], ['Chat'], ['聊天']]);
    } finally {
      root.unmount();
    }
  });
});
