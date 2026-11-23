import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ToasterProps } from 'sonner';
import { expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import { toast, Toaster } from '../sonner';

const state = vi.hoisted(() => ({ locale: 'zh' as Locale }));
const renderSonner = vi.fn<(props: ToasterProps) => void>();
vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (value: typeof state) => Locale) => select(state),
}));
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useState: vi.fn(react.useState) };
});
vi.mock('sonner', async (importOriginal) => {
  const sonner = await importOriginal<typeof import('sonner')>();
  return {
    ...sonner,
    Toaster: (props: ToasterProps) => {
      renderSonner(props);
      return createElement(sonner.Toaster, props);
    },
  };
});

it.each([
  [
    'en',
    'Notifications',
    'Close notification',
    'Show details',
    'Copy error details',
    'Copy',
    'Copied',
    'Close',
  ],
  [
    'zh',
    '通知',
    '关闭通知',
    '展开详情',
    '复制错误信息',
    '复制',
    '已复制',
    '关闭',
  ],
] as const)(
  'localizes Sonner error controls and announcements in %s without changing the error history',
  (
    locale,
    notifications,
    closeNotification,
    show,
    copyError,
    copy,
    copied,
    close,
  ) => {
    state.locale = locale;
    const toaster = renderToStaticMarkup(createElement(Toaster));
    expect(toaster).toContain(`aria-label="${notifications} alt+T"`);
    expect(renderSonner).toHaveBeenLastCalledWith(
      expect.objectContaining({
        toastOptions: expect.objectContaining({
          closeButtonAriaLabel: closeNotification,
        }),
      }),
    );

    const message = '请求失败 (E_CONNECTION)';
    const diagnostic = 'raw  error <from provider>\n连接中断 E_CONNECTION';
    const action = { label: 'Provider action', onClick: vi.fn() };
    const id = toast.error(message, { description: diagnostic, action });
    const entry = toast.raw.getHistory().at(-1);
    if (!entry || !('description' in entry))
      throw new Error('Missing error toast');
    expect(entry).toMatchObject({ id, type: 'error', title: message, action });
    const { description } = entry;
    const render = () =>
      renderToStaticMarkup(
        typeof description === 'function' ? description() : description,
      );
    const collapsed = render();
    expect(collapsed).toContain(`>${show}</button>`);
    expect(collapsed).toContain(
      'raw error &lt;from provider&gt; 连接中断 E_CONNECTION',
    );

    vi.mocked(useState).mockReturnValueOnce([true, vi.fn()]);
    const expanded = render();
    expect(expanded).toContain(
      `title="${copyError}" aria-label="${copyError}"`,
    );
    expect(expanded).toContain(`>${copy}</span>`);
    expect(expanded).toContain(`title="${close}" aria-label="${close}"`);
    expect(expanded).toContain(`>${close}</span>`);
    expect(expanded).toContain(
      'raw  error &lt;from provider&gt;\n连接中断 E_CONNECTION',
    );

    vi.mocked(useState)
      .mockReturnValueOnce([true, vi.fn()])
      .mockReturnValueOnce([true, vi.fn()]);
    const copiedState = render();
    expect(copiedState).toContain(`title="${copied}" aria-label="${copied}"`);
    expect(copiedState).toContain(`>${copied}</span>`);
    expect(toast.raw.getHistory().at(-1)).toBe(entry);
  },
);
