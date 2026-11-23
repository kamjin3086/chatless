import React, { createElement, useEffect, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import type { Locale } from '@/i18n/types';
import {
  UPDATE_AVAILABILITY_EVENT,
  UNKNOWN_UPDATE_VERSION,
} from '@/lib/update/update-notifier';
import { linkOpener } from '@/lib/utils/linkOpener';
import { StartupUpdateToast } from '../StartupUpdateToast';

const state = vi.hoisted(() => ({ locale: 'zh' as Locale }));
const actions = new Map<string, () => void>();
vi.mock('@/store/localeStore', () => ({
  useLocaleStore: Object.assign(
    (select: (value: typeof state) => Locale) => select(state),
    {
      getState: () => state,
    },
  ),
}));
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useEffect: vi.fn(react.useEffect) };
});
vi.mock('@/components/ui/button', async (importOriginal) => {
  const button =
    await importOriginal<typeof import('@/components/ui/button')>();
  return {
    Button: (props: ComponentProps<typeof Button>) => {
      if (typeof props.children === 'string' && props.onClick) {
        const { onClick } = props;
        actions.set(props.children, () =>
          onClick({} as React.MouseEvent<HTMLButtonElement>),
        );
      }
      return createElement(button.Button, props);
    },
  };
});
vi.mock('@/lib/storage', () => ({
  default: { getItem: vi.fn().mockResolvedValue(null) },
}));
vi.mock('@/lib/utils/linkOpener', () => ({
  linkOpener: { openReleases: vi.fn() },
}));
vi.mock('@tauri-apps/plugin-updater', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/plugin-updater')>()),
  check: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));

beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('window', new EventTarget());
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  actions.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function latestToast() {
  const entry = toast.raw.getHistory().at(-1);
  if (!entry || !('title' in entry)) throw new Error('Missing toast');
  return entry;
}

function renderToast() {
  const { title } = latestToast();
  return renderToStaticMarkup(typeof title === 'function' ? title() : title);
}

async function notify(version: string, body?: string) {
  const count = toast.raw.getHistory().length;
  window.dispatchEvent(
    new CustomEvent(UPDATE_AVAILABILITY_EVENT, {
      detail: { available: true, version, body },
    }),
  );
  await vi.waitFor(() =>
    expect(toast.raw.getHistory()).toHaveLength(count + 1),
  );
  return renderToast();
}

function click(label: string) {
  const action = actions.get(label);
  if (!action) throw new Error(`Missing action: ${label}`);
  return action();
}

it.each([
  [
    'en',
    {
      available: 'New update available',
      versioned: 'New version available: v0.8.3-$&',
      recommendation: 'Update to get the latest features and fixes.',
      download: 'Download update',
      releases: 'View release page',
      skip: 'Skip this version',
      close: 'Close',
      note: 'Release notes',
      upToDate: 'You’re on the latest version',
      installed: 'Update installed. Restarting Chatless…',
      failed: 'Could not download or install the update',
      offline: 'You’re offline. Check your connection and try again.',
      online:
        'Check your connection and try again, or download the installer from the release page.',
      retry: 'Retry',
      restart: 'Restart app',
      noReleases: 'Could not open the release page',
    },
  ],
  [
    'zh',
    {
      available: '发现新版本',
      versioned: '发现新版本 v0.8.3-$&',
      recommendation: '建议更新以获取最新功能与修复。',
      download: '下载更新',
      releases: '查看发布页',
      skip: '忽略此版本',
      close: '关闭',
      note: '版本说明',
      upToDate: '已是最新版本',
      installed: '更新已安装，即将重启应用',
      failed: '下载或安装更新失败',
      offline: '当前网络不可用，请检查网络连接后再试。',
      online: '可能是网络问题，请检查网络后重试，或前往发布页手动下载安装包。',
      retry: '重试',
      restart: '重启应用',
      noReleases: '无法打开发布页',
    },
  ],
] as const)(
  'localizes the startup update flow in %s without changing native calls or raw diagnostics',
  async (locale, text) => {
    state.locale = locale;
    vi.mocked(useEffect)
      .mockImplementationOnce(() => {}) // Do not load preferences or schedule native checks.
      .mockImplementationOnce(() => {})
      .mockImplementationOnce((subscribe) => {
        subscribe();
      });
    renderToStaticMarkup(createElement(StartupUpdateToast));

    const available = await notify(
      '0.8.3-$&',
      '## zh-CN\n版本说明\n\n## en-US\nRelease notes',
    );
    expect(latestToast().duration).toBe(60000);
    for (const label of [
      text.recommendation,
      text.download,
      text.releases,
      text.skip,
      text.note,
    ]) {
      expect(available).toContain(`>${label}<`);
    }
    expect(available).toContain(text.versioned.replace('&', '&amp;'));
    expect(available).toContain(`aria-label="${text.close}"`);
    expect(await notify(UNKNOWN_UPDATE_VERSION)).toContain(
      `>${text.available}<`,
    );

    vi.mocked(linkOpener.openReleases).mockResolvedValue(false);
    await click(text.releases);
    expect(latestToast().title).toBe(text.noReleases);

    const diagnostic = new Error('native updater: 验证失败 E_SIGNATURE');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const onLine of [false, true]) {
      vi.stubGlobal('navigator', { onLine });
      vi.mocked(check).mockRejectedValueOnce(diagnostic);
      await click(text.download);
      expect(latestToast().duration).toBe(20000);
      const failure = renderToast();
      for (const label of [
        text.failed,
        onLine ? text.online : text.offline,
        text.retry,
        text.restart,
        text.releases,
      ]) {
        expect(failure).toContain(`>${label}<`);
      }
    }
    expect(log).toHaveBeenCalledWith('下载或安装更新失败:', diagnostic);
    expect(check).toHaveBeenLastCalledWith({ timeout: 30_000 });

    vi.mocked(check).mockResolvedValueOnce(null);
    await click(text.retry);
    expect(latestToast().title).toBe(text.upToDate);

    const update = new Update({
      rid: 1,
      currentVersion: '0.8.2',
      version: '0.8.3',
      rawJson: {},
    });
    const install = vi
      .spyOn(update, 'downloadAndInstall')
      .mockResolvedValue(undefined);
    vi.mocked(check).mockResolvedValueOnce(update);
    await click(text.download);
    expect(install).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
    expect(latestToast().title).toBe(text.installed);
  },
);
