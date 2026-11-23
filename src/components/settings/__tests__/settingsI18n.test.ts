import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import { GeneralSettings } from '../GeneralSettings';
import { SettingsSidebar } from '../SettingsSidebar';

const localeState = vi.hoisted(() => ({
  locale: 'zh' as Locale,
  setLocale: vi.fn(),
}));

vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: typeof localeState) => unknown) =>
    select(localeState),
}));

vi.mock('../PersonalizationSettings', () => ({
  PersonalizationSettings: () => null,
}));

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

it.each([
  {
    locale: 'zh',
    heading: '设置',
    tabs: [
      '常规',
      'AI模型',
      '知识库',
      '同步',
      '网络搜索',
      '安全',
      '高级',
      '关于',
    ],
  },
  {
    locale: 'en',
    heading: 'Settings',
    tabs: [
      'General',
      'AI Models',
      'Knowledge Base',
      'Sync',
      'Web Search',
      'Security',
      'Advanced',
      'About',
    ],
  },
] as const)(
  'renders SettingsSidebar labels in $locale',
  ({ locale, heading, tabs }) => {
    localeState.locale = locale;
    const html = renderToStaticMarkup(
      createElement(SettingsSidebar, {
        activeTab: 'localModels',
        onTabChange: vi.fn(),
      }),
    );
    expect(html).toContain(`>${heading}</h3>`);
    const buttons = [
      ...html.matchAll(
        /<button\b[^>]*>[\s\S]*?<span\b[^>]*>([^<]+)<\/span>[\s\S]*?<\/button>/g,
      ),
    ];
    expect(buttons.map(([, label]) => label)).toEqual(tabs);
    expect(
      buttons.find(([button]) => button.includes('font-medium'))?.[1],
    ).toBe(tabs[1]);
  },
);

it.each([
  {
    locale: 'zh',
    labels: [
      '基础选项',
      '聊天显示',
      '界面显示',
      '使用快捷键快速搜索和执行操作',
    ],
    languageLabels: ['简体中文', '英语 (English)'],
    themeLabels: ['跟随系统', '亮色', '暗色'],
    shortcutPlaceholder: '按下组合键...',
  },
  {
    locale: 'en',
    labels: [
      'Basic options',
      'Chat display',
      'Interface display',
      'Use a keyboard shortcut to quickly find and run commands.',
    ],
    languageLabels: ['Simplified Chinese (简体中文)', 'English'],
    themeLabels: ['Follow system', 'Light', 'Dark'],
    shortcutPlaceholder: 'Press a key combination…',
  },
] as const)(
  'renders GeneralSettings copy in $locale without changing option values or defaults',
  ({ locale, labels, languageLabels, themeLabels, shortcutPlaceholder }) => {
    localeState.locale = locale;
    const html = renderToStaticMarkup(createElement(GeneralSettings));
    for (const label of labels) expect(html).toContain(`>${label}<`);

    const options = [
      ...html.matchAll(
        /<option value="([^"]+)"( selected="")?>([^<]+)<\/option>/g,
      ),
    ];
    expect(
      options
        .slice(0, 5)
        .map(([, value, selected, label]) => [value, !!selected, label]),
    ).toEqual([
      ['zh', locale === 'zh', languageLabels[0]],
      ['en', locale === 'en', languageLabels[1]],
      ['system', true, themeLabels[0]],
      ['light', false, themeLabels[1]],
      ['dark', false, themeLabels[2]],
    ]);
    expect(
      options.slice(5).map(([, value, selected]) => [value, !!selected]),
    ).toEqual([
      ['small', false],
      ['medium', true],
      ['large', false],
      ['off', false],
      ['light', false],
      ['normal', true],
      ['strong', false],
      ['small', false],
      ['medium', true],
      ['large', false],
    ]);
    expect(html).toContain(`placeholder="${shortcutPlaceholder}"`);
    expect(html).toContain('value="⌃ + P"');
  },
);
