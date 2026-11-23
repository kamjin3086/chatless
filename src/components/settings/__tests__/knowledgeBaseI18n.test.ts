import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import { EmbeddingServiceStatus } from '../EmbeddingServiceStatus';
import { KnowledgeBaseSettings } from '../KnowledgeBaseSettings';

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
    statusHeading: '嵌入服务状态',
    offline: '离线',
    serviceTypeLabel: '嵌入服务类型',
    unset: '未配置',
    hint: '上方模型管理器',
    testButton: '测试嵌入生成',
    refresh: '刷新',
    viewDetails: '查看详细信息',
    loading: '加载配置中...',
  },
  {
    locale: 'en',
    statusHeading: 'Embedding service status',
    offline: 'Offline',
    serviceTypeLabel: 'Embedding service type',
    unset: 'Not configured',
    hint: 'model manager above',
    testButton: 'Test embedding generation',
    refresh: 'Refresh',
    viewDetails: 'View details',
    loading: 'Loading configuration…',
  },
] as const)(
  'renders knowledge base settings copy in $locale',
  ({
    locale,
    statusHeading,
    offline,
    serviceTypeLabel,
    unset,
    hint,
    testButton,
    refresh,
    viewDetails,
    loading,
  }) => {
    localeState.locale = locale;
    const statusHtml = renderToStaticMarkup(
      createElement(EmbeddingServiceStatus),
    );
    expect(statusHtml).toContain(statusHeading);
    expect(statusHtml).toContain(offline);
    expect(statusHtml).toContain(serviceTypeLabel);
    expect(statusHtml).toContain(unset);
    expect(statusHtml).toContain(hint);
    expect(statusHtml).toContain(testButton);
    expect(statusHtml).toContain(refresh);
    expect(statusHtml).toContain(`title="${viewDetails}"`);

    const settingsHtml = renderToStaticMarkup(
      createElement(KnowledgeBaseSettings),
    );
    expect(settingsHtml).toContain(loading);
  },
);
