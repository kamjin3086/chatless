import React, { createElement, useState, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { check, Update } from '@tauri-apps/plugin-updater';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import type { Locale } from '@/i18n/types';
import { UNKNOWN_UPDATE_VERSION } from '@/lib/update/update-notifier';
import { AboutSupportSettings } from '../AboutSupportSettings';

const state = vi.hoisted(() => ({ locale: 'zh' as Locale }));
const actions = new Map<string, () => void>();
vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (value: typeof state) => Locale) => select(state),
}));
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useState: vi.fn(react.useState) };
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
vi.mock('@tauri-apps/plugin-updater', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/plugin-updater')>()),
  check: vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('window', { __CHATLESS_ONLY_CHECK_UPDATE__: true });
});
afterEach(() => {
  actions.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderAbout(version: string) {
  // Seed the availability snapshot normally set by the effect.
  vi.mocked(useState)
    .mockReturnValueOnce([false, vi.fn()])
    .mockReturnValueOnce([{ version: '0.8.2', build: 'test-build' }, vi.fn()])
    .mockReturnValueOnce([true, vi.fn()])
    .mockReturnValueOnce([{ version }, vi.fn()]);
  return renderToStaticMarkup(createElement(AboutSupportSettings));
}

it.each([
  [
    'en',
    'Check for updates',
    'Check for updates without installing',
    'An update is available (0.8.3)',
    'An update is available',
    'New',
    'Update found: 0.8.3',
    'Turn off check-only mode to install the update.',
    'English notes',
  ],
  [
    'zh',
    '检查更新',
    '仅检查更新，不自动安装',
    '当前不是最新版本（可用：0.8.3）',
    '当前不是最新版本',
    '新版本',
    '检测到更新：0.8.3',
    '如需安装，请取消仅检查更新。',
    '中文说明',
  ],
] as const)(
  'localizes the About update status and manual check-only notice in %s',
  async (
    locale,
    checkLabel,
    onlyCheck,
    outdated,
    unknown,
    badge,
    found,
    hint,
    notes,
  ) => {
    state.locale = locale;
    const markup = renderAbout('0.8.3');
    for (const label of [checkLabel, onlyCheck, outdated, badge]) {
      expect(markup).toContain(`>${label}<`);
    }
    expect(renderAbout(UNKNOWN_UPDATE_VERSION)).toContain(`>${unknown}<`);

    const update = new Update({
      rid: 1,
      currentVersion: '0.8.2',
      version: '0.8.3',
      rawJson: {},
      body: '## zh-CN\n中文说明\n\n## en-US\nEnglish notes',
    });
    const install = vi
      .spyOn(update, 'downloadAndInstall')
      .mockResolvedValue(undefined);
    vi.mocked(check).mockResolvedValueOnce(update);
    const action = actions.get(checkLabel);
    if (!action) throw new Error(`Missing action: ${checkLabel}`);
    await action();
    expect(check).toHaveBeenLastCalledWith({ timeout: 30_000 });
    expect(install).not.toHaveBeenCalled();
    const entry = toast.raw.getHistory().at(-1);
    if (!entry || !('description' in entry))
      throw new Error('Missing manual update toast');
    expect(entry.title).toBe(found);
    const { description } = entry;
    const notice = renderToStaticMarkup(
      typeof description === 'function' ? description() : description,
    );
    expect(notice).toContain(`>${hint}<`);
    expect(notice).toContain(`>${notes}<`);
  },
);

it.each([
  [
    'en',
    'About &amp; Support',
    'Help Center',
    'Feedback',
    'Official website',
    'Community',
    'Terms of Service',
    'Privacy Policy',
  ],
  [
    'zh',
    '关于与支持',
    '帮助中心',
    '意见反馈',
    '官方网站',
    '用户社区',
    '服务条款',
    '隐私政策',
  ],
] as const)(
  'localizes the About & Support page copy in %s',
  (locale, title, help, feedback, website, community, terms, privacy) => {
    state.locale = locale;
    const markup = renderAbout('0.8.2');
    for (const label of [
      title,
      help,
      feedback,
      website,
      community,
      terms,
      privacy,
    ]) {
      expect(markup).toContain(`>${label}<`);
    }
  },
);
