import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { toast } from '@/components/ui/sonner';
import { translate } from '@/i18n';
import type { Locale, TranslationKey } from '@/i18n/types';
import * as windowFit from '@/lib/window/windowFit';
import { savePersistedWindowState } from '@/lib/window/windowState';
import { PersonalizationSettings } from '../PersonalizationSettings';

const settings = vi.hoisted(() => ({
  locale: 'zh' as Locale,
  glassTheme: true,
  glassWallpaperFile: 'wallpaper.jpg',
  windowSizePreset: '1024x768',
  setWindowSizePreset: vi.fn(),
  sidebarWidth: 'xwide',
  sidebarIconSize: 'large',
  timezone: 'America/New_York',
}));

vi.mock('@/store/uiPreferences', () => ({
  useUiPreferences: () => settings,
}));
vi.mock('@/store/localeStore', () => ({
  useLocaleStore: () => ({
    locale: settings.locale,
    t: (key: TranslationKey) => translate(settings.locale, key),
  }),
}));

const selectChanges = vi.hoisted(
  () => new Map<string, (value: string) => void>(),
);
vi.mock('../SelectField', async (importOriginal) => {
  const { SelectField } =
    await importOriginal<typeof import('../SelectField')>();
  return {
    SelectField: (props: React.ComponentProps<typeof SelectField>) => {
      selectChanges.set(props.label, props.onChange);
      return createElement(SelectField, props);
    },
  };
});
vi.mock('@/lib/window/windowState', () => ({
  savePersistedWindowState: vi.fn().mockResolvedValue(undefined),
}));

beforeAll(() => vi.stubGlobal('React', React));
afterEach(() => {
  selectChanges.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
afterAll(() => vi.unstubAllGlobals());

function render(locale: Locale, glassTheme = true) {
  settings.locale = locale;
  settings.glassTheme = glassTheme;
  return renderToStaticMarkup(createElement(PersonalizationSettings));
}

describe('PersonalizationSettings', () => {
  it('localizes the appearance controls, wallpaper actions and layout labels in both locales', () => {
    const en = render('en');
    const zh = render('zh');
    for (const [english, chinese] of [
      ['Appearance and experience', '外观与体验'],
      ['Simple mode', '简洁模式'],
      ['Tone down colors, shadows', '弱化颜色、阴影'],
      ['Reduced motion', '低动画模式'],
      ['Reduce transitions and fades', '减少过渡动画和淡入淡出效果'],
      ['Glass theme', '玻璃主题'],
      ['Use translucent, frosted-glass panels', '半透明毛玻璃面板'],
      ['Chat wallpaper', '聊天壁纸'],
      ['Only the first frame', '动图只取首帧'],
      ['Choose image', '选择图片'],
      ['>Clear</button>', '>清除</button>'],
      ['Show icons on settings pages', '显示设置页图标'],
      ['App window size', '应用窗口尺寸'],
      ['Main sidebar width', '主侧边栏宽度'],
      ['Sidebar icon size', '侧边栏图标大小'],
      ['Time zone for displayed times', '显示时间时区'],
    ]) {
      expect(en).toContain(english);
      expect(en).not.toContain(chinese);
      expect(zh).toContain(chinese);
    }
  });

  it.each(['en', 'zh'] as const)(
    'keeps the same stored select values in %s',
    (locale) => {
      const html = render(locale);
      const values = [...html.matchAll(/<select\b[^>]*>(.*?)<\/select>/g)].map(
        ([, list]) =>
          [...list.matchAll(/<option value="([^"]+)"/g)].map(
            ([, value]) => value,
          ),
      );
      expect(values).toEqual([
        ['900x700', '1024x768', '1280x800', '1366x768', '1440x900', '1600x900'],
        ['narrow', 'medium', 'wide', 'xwide'],
        ['small', 'medium', 'large'],
        [
          'local',
          'UTC',
          'UTC+8',
          'America/New_York',
          'Europe/London',
          'Asia/Tokyo',
        ],
      ]);
      const labels =
        locale === 'en'
          ? [
              '1024 × 768 (default)',
              'Extra wide',
              'Large',
              'New York (UTC-4/5)',
            ]
          : ['1024 × 768（默认）', '超宽', '大', '纽约 (UTC-4/5)'];
      expect(
        [...html.matchAll(/<option [^>]* selected="">([^<]+)<\/option>/g)].map(
          ([, label]) => label,
        ),
      ).toEqual(labels);
    },
  );

  it.each([
    [
      'en',
      'App window size',
      'Current display work area: 1227 × 691. Window reduced to 1227 × 690.',
    ],
    ['zh', '应用窗口尺寸', '当前显示器可用 1227 × 691，窗口已缩到 1227 × 690'],
  ] as const)(
    'reports a reduced window size in %s without changing the preset',
    async (locale, label, message) => {
      const apply = vi
        .spyOn(windowFit, 'applyWindowSizePreset')
        .mockResolvedValue(
          windowFit.describeWindowFit(
            { width: 1280, height: 800 },
            {
              size: { width: 1227.2, height: 690.6 },
              workArea: { width: 1227.2, height: 690.6 },
            },
          ),
        );
      const notify = vi.spyOn(toast, 'info').mockImplementation(() => 0);
      render(locale);
      const change = selectChanges.get(label);
      expect(change).toBeDefined();
      await change?.('1280x800');
      expect(settings.setWindowSizePreset).toHaveBeenCalledWith('1280x800');
      expect(apply).toHaveBeenCalledWith('1280x800');
      expect(savePersistedWindowState).toHaveBeenCalledOnce();
      expect(notify).toHaveBeenCalledWith(message);
    },
  );

  it('keeps wallpaper controls hidden while the glass theme is off', () => {
    const html = render('en', false);
    expect(html).toContain('Glass theme');
    expect(html).not.toContain('Chat wallpaper');
    expect(html).not.toContain('type="file"');
  });
});
