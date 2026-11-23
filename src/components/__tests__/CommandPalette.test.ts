import React, { createElement, type PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import { CommandPalette } from '../CommandPalette';

const localeState = vi.hoisted(() => ({ locale: 'zh' as Locale }));
const commandState = vi.hoisted(() => ({
  commands: [] as {
    id: string;
    titleI18n: string;
    section: string;
    hintI18n?: string;
    keywords?: string[];
    action: () => void;
  }[],
}));
vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: typeof localeState) => Locale) =>
    select(localeState),
}));
vi.mock('@/store/uiPreferences', () => ({
  useUiPreferences: () => ({
    cmdPaletteEnabled: true,
    cmdPaletteShortcut: 'mod+k',
  }),
}));
vi.mock('@/commands/commandRegistry', () => ({
  getCommands: () => commandState.commands,
}));
vi.mock('@/components/ui/dialog', () => {
  // Render the panel body without the browser-only portal.
  const renderChildren = ({ children }: PropsWithChildren) => children;
  return {
    Dialog: renderChildren,
    DialogContent: renderChildren,
    DialogTitle: renderChildren,
    DialogDescription: renderChildren,
  };
});
vi.stubGlobal('React', React);

it.each([
  ['en', 'Search commands…', 'No matching commands'],
  ['zh', '输入以搜索指令…', '没有匹配项'],
] as const)(
  'uses the selected locale %s for the standalone search input and empty state',
  (locale, placeholder, empty) => {
    localeState.locale = locale;
    const html = renderToStaticMarkup(createElement(CommandPalette));
    expect(html).toContain(`placeholder="${placeholder}"`);
    expect(html).toContain(`>${empty}<`);
  },
);

it.each([
  ['en', 'Home', '/ (Home)', 'Navigation'],
  ['zh', '首页', '/ (首页)', '导航'],
] as const)(
  'localizes command titles, hints and section labels in %s',
  (locale, title, hint, section) => {
    localeState.locale = locale;
    commandState.commands = [
      {
        id: 'nav-home',
        titleI18n: 'command.home',
        section: 'navigation',
        hintI18n: 'command.homeHint',
        action: () => {},
      },
    ];
    const html = renderToStaticMarkup(createElement(CommandPalette));
    expect(html).toContain(`>${title}<`);
    expect(html).toContain(`>${hint}<`);
    expect(html).toContain(`>${section}<`);
  },
);
