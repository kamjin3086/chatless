import React, { createElement, type PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ProviderWithStatus } from '@/hooks/useProviderManagement';
import type { Locale } from '@/i18n/types';
import { ProviderHeader } from '../ProviderHeader';
import { UniversalModelManager } from '../UniversalModelManager';

const state = vi.hoisted(() => ({
  locale: 'zh' as Locale,
}));

vi.mock('@/store/localeStore', () => {
  const getState = () => ({ locale: state.locale });
  const useLocaleStore = (
    selector: (snapshot: ReturnType<typeof getState>) => unknown,
  ) => selector(getState());
  return { useLocaleStore: Object.assign(useLocaleStore, { getState }) };
});

vi.mock('@/components/ui/sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/lib/embedding/OnnxModelDownloader', () => ({
  OnnxModelDownloader: class {
    async waitUntilReady() {}
    isModelDownloaded() {
      return false;
    }
    async downloadModel() {}
    async deleteModel() {}
    async getModelPaths() {
      return null;
    }
  },
}));

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt?: string; src?: string }) =>
    createElement('img', { alt, src }),
}));

vi.mock('@/components/ui/dropdown-menu', () => {
  const inline = ({ children }: PropsWithChildren) => children;
  return {
    DropdownMenu: inline,
    DropdownMenuContent: inline,
    DropdownMenuItem: ({
      children,
      title,
    }: PropsWithChildren<{ title?: string }>) =>
      title
        ? createElement('span', { 'data-title': title }, children)
        : children,
    DropdownMenuLabel: inline,
    DropdownMenuSeparator: () => null,
    DropdownMenuTrigger: inline,
  };
});

vi.mock('@/components/ui/tooltip', () => {
  const inline = ({ children }: PropsWithChildren) => children;
  return {
    Tooltip: inline,
    TooltipContent: inline,
    TooltipProvider: inline,
    TooltipTrigger: inline,
  };
});

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

const noop = () => {};

const provider: ProviderWithStatus = {
  name: 'ProviderFixture',
  displayName: 'Provider Fixture',
  api_base_url: 'https://example.com/v1',
  requiresApiKey: true,
  models: [],
};

const renderHeader = () =>
  renderToStaticMarkup(
    createElement(ProviderHeader, {
      provider,
      isConnecting: false,
      isGloballyInitializing: false,
      resolvedIconSrc: '/icons/provider.svg',
      onRefresh: noop,
      onOpenFetchDebugger: noop,
      hasFetchRule: true,
      onOpenSettings: noop,
      onResetUrl: noop,
    }),
  );

const renderManager = () =>
  renderToStaticMarkup(createElement(UniversalModelManager));

describe('Universal models and provider header i18n', () => {
  it.each([
    {
      locale: 'zh',
      strategy: ['Ollama 服务', '本地模型'],
      description: '本地离线推理模型，支持完全离线使用，无需外部服务',
      testTitle: '测试',
      refreshTitle: '刷新',
      hintTitle: '本地离线推理',
      hintLines: [
        '完全本地推理，生成高质量嵌入向量',
        '适用于离线环境或对数据隐私要求极高的场景',
        '无需外部服务或网络连接',
        '生产环境也可直接使用',
      ],
    },
    {
      locale: 'en',
      strategy: ['Ollama service', 'Local model'],
      description:
        'Local offline inference model; fully offline, no external service required',
      testTitle: 'Test',
      refreshTitle: 'Refresh',
      hintTitle: 'Local offline inference',
      hintLines: [
        'Fully local inference producing high-quality embedding vectors',
        'For offline environments or scenarios with strict data-privacy requirements',
        'No external service or network connection required',
        'Ready for production use',
      ],
    },
  ] as const)(
    'renders UniversalModelManager copy in $locale without changing model values',
    ({
      locale,
      strategy,
      description,
      testTitle,
      refreshTitle,
      hintTitle,
      hintLines,
    }) => {
      state.locale = locale;
      const html = renderManager();

      expect(html).toContain(`>${strategy[0]}</span>`);
      expect(html).toContain(`>${strategy[1]}</span>`);
      expect(html).toContain(`>${description}</p>`);
      expect(html).toContain(`title="${testTitle}"`);
      expect(html).toContain(`title="${refreshTitle}"`);
      expect(html).toContain(`>${hintTitle}</p>`);
      for (const line of hintLines) {
        expect(html).toContain(`>• ${line}</li>`);
      }
    },
  );

  it.each([
    {
      locale: 'zh',
      iconAlt: 'ProviderFixture 图标',
      fetchDebuggerTitle: '模型获取调试器',
      settingsTitle: '提供商设置',
      advancedOptions: '高级选项',
      advancedOptionsHint: '请求方式等',
    },
    {
      locale: 'en',
      iconAlt: 'ProviderFixture icon',
      fetchDebuggerTitle: 'Model fetch debugger',
      settingsTitle: 'Provider settings',
      advancedOptions: 'Advanced options',
      advancedOptionsHint: 'Request method and more',
    },
  ] as const)(
    'renders ProviderHeader icon alt and menu items in $locale while preserving provider identity',
    ({
      locale,
      iconAlt,
      fetchDebuggerTitle,
      settingsTitle,
      advancedOptions,
      advancedOptionsHint,
    }) => {
      state.locale = locale;
      const html = renderHeader();

      expect(html).toContain(`alt="${iconAlt}"`);
      expect(html).toContain(`title="${fetchDebuggerTitle}"`);
      expect(html).toContain(`title="${settingsTitle}"`);
      expect(html).toContain(settingsTitle);
      expect(html).toContain(advancedOptions);
      expect(html).toContain(`data-title="${advancedOptionsHint}"`);
      // Provider identity is not localized and must stay intact.
      expect(html).toContain('ProviderFixture');
      expect(html).toContain('Provider Fixture');
    },
  );
});
