import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import { InputField } from '../InputField';
import { ModelCard } from '../ModelCard';
import { NativeToolAuthSettings } from '../NativeToolAuthSettings';

const localeState = vi.hoisted(() => ({
  locale: 'zh' as Locale,
  setLocale: vi.fn(),
}));

vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: typeof localeState) => unknown) =>
    select(localeState),
}));

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

it.each([
  {
    locale: 'zh',
    passwordShow: '显示密码',
    connected: '已连接',
    serviceUrl: '服务地址',
    serviceUrlPlaceholder: '输入Ollama服务地址',
    nativeToolLabel: '命令执行确认',
    nativeToolTooltip:
      '是否在运行命令前弹出确认。全局默认可在 MCP 高级设置中调整。',
    nativeToolOptions: [
      '跟随默认（每次确认）',
      '每次确认',
      '自动授权',
    ],
  },
  {
    locale: 'en',
    passwordShow: 'Show password',
    connected: 'Connected',
    serviceUrl: 'Service URL',
    serviceUrlPlaceholder: 'Enter Ollama service URL',
    nativeToolLabel: 'Command execution confirmation',
    nativeToolTooltip:
      'Whether to show a confirmation before running a command. The global default can be changed in MCP advanced settings.',
    nativeToolOptions: [
      'Follow default (Confirm every time)',
      'Confirm every time',
      'Auto-authorize',
    ],
  },
] as const)(
  'renders settings leftovers copy in $locale',
  ({
    locale,
    passwordShow,
    connected,
    serviceUrl,
    serviceUrlPlaceholder,
    nativeToolLabel,
    nativeToolTooltip,
    nativeToolOptions,
  }) => {
    localeState.locale = locale;

    const inputHtml = renderToStaticMarkup(
      createElement(InputField, {
        label: 'secret',
        type: 'password',
        value: 'value',
      }),
    );
    expect(inputHtml).toContain(`aria-label="${passwordShow}"`);

    const cardHtml = renderToStaticMarkup(
      createElement(ModelCard, {
        icon: '🧠',
        name: 'Ollama',
        isConnected: true,
        serviceUrl: '',
        onServiceUrlChange: vi.fn(),
      }),
    );
    expect(cardHtml).toContain(`>${connected}<`);
    expect(cardHtml).toContain(`>${serviceUrl}<`);
    expect(cardHtml).toContain(`placeholder="${serviceUrlPlaceholder}"`);

    const nativeToolHtml = renderToStaticMarkup(
      createElement(NativeToolAuthSettings),
    );
    expect(nativeToolHtml).toContain(`>${nativeToolLabel}<`);
    expect(nativeToolHtml).toContain(nativeToolTooltip);
    for (const option of nativeToolOptions) {
      expect(nativeToolHtml).toContain(`>${option}<`);
    }
  },
);
