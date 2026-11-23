import React, { createElement, type PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderWithStatus } from '@/hooks/useProviderManagement';
import type { Locale } from '@/i18n/types';
import { AVAILABLE_PROVIDERS_CATALOG } from '@/lib/provider/catalog';
import { AddProvidersDialog } from '../AddProvidersDialog';
import { AiModelSettings } from '../AiModelSettings';
import { ProviderConnectionSection } from '../ProviderConnectionSection';

const state = vi.hoisted(() => ({
  locale: 'zh' as Locale,
  setVisibility: vi.fn(),
  toastError: vi.fn(),
  checkboxActions: new Map<string, (checked: boolean) => Promise<void>>(),
}));

vi.stubGlobal('React', React);

// Server rendering cannot read the client store snapshot or mount Radix portals.
vi.mock('@/store/localeStore', () => {
  const getState = () => ({ locale: state.locale });
  const useLocaleStore = (
    selector: (snapshot: ReturnType<typeof getState>) => unknown,
  ) => selector(getState());
  return { useLocaleStore: Object.assign(useLocaleStore, { getState }) };
});
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: PropsWithChildren) =>
    createElement('div', null, children),
  DialogContent: ({ children }: PropsWithChildren) =>
    createElement('div', null, children),
  DialogHeader: ({ children }: PropsWithChildren) =>
    createElement('header', null, children),
  DialogTitle: ({ children }: PropsWithChildren) =>
    createElement('h2', null, children),
  DialogTrigger: ({ children }: PropsWithChildren) => children,
}));
vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({
    id,
    onCheckedChange,
  }: {
    id: string;
    onCheckedChange: (checked: boolean) => Promise<void>;
  }) => {
    state.checkboxActions.set(id, onCheckedChange);
    return createElement('input', { id, type: 'checkbox' });
  },
}));
vi.mock('@/components/ui/sonner', () => ({
  toast: { error: state.toastError },
}));
vi.mock('@/lib/provider/ProviderRepository', () => ({
  providerRepository: { setVisibility: state.setVisibility },
}));
vi.mock('@/lib/provider/catalog', async (importOriginal) => {
  const catalog =
    await importOriginal<typeof import('@/lib/provider/catalog')>();
  return {
    ...catalog,
    AVAILABLE_PROVIDERS_CATALOG: [...catalog.AVAILABLE_PROVIDERS_CATALOG],
  };
});
vi.mock('@/hooks/useProviderManagement', () => ({
  useProviderManagement: () => ({ providers: [], isLoading: false }),
}));
vi.mock('../ProviderSettings', () => ({ ProviderSettings: () => null }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const provider: ProviderWithStatus = {
  name: 'CustomProvider',
  api_base_url: '',
  requiresApiKey: true,
  configStatus: 'NO_KEY',
  models: [],
};

const chooser = () =>
  createElement(AddProvidersDialog, { open: true, trigger: null });

beforeEach(() => {
  state.locale = 'zh';
  state.checkboxActions.clear();
  state.setVisibility.mockReset();
  state.toastError.mockReset();
});

describe('Provider onboarding copy', () => {
  it.each([
    ['zh', '服务地址', '获取密钥', '未配置密钥', '显示密钥'],
    ['en', 'Service URL', 'Get an API key', 'No API key set', 'Show API key'],
  ] as const)(
    'renders the connection and key controls in %s without exposing the key',
    (locale, address, getKey, noKey, showKey) => {
      state.locale = locale;
      const noop = () => {};
      const html = renderToStaticMarkup(
        createElement(ProviderConnectionSection, {
          provider,
          localUrl: '',
          setLocalUrl: noop,
          onUrlChange: noop,
          showApiKeyFields: true,
          localDefaultApiKey: 'test-key-do-not-render',
          setLocalDefaultApiKey: noop,
          docUrl: 'https://example.com/docs',
          onDefaultApiKeyChange: noop,
          onDefaultApiKeyBlur: noop,
        }),
      );
      expect(html).toContain(address);
      expect(html).toContain(getKey);
      expect(html).toContain(noKey);
      expect(html).toContain(`title="${showKey}"`);
      expect(html).toContain('••••••••');
      expect(html).not.toContain('test-key-do-not-render');
    },
  );

  it('translates chooser catalog labels but not provider names, strategies, or URLs', () => {
    state.locale = 'en';
    const html = renderToStaticMarkup(chooser());
    expect(html).toContain('Add or manage providers');
    expect(html).toContain('Recommended local providers');
    expect(html).toContain('API key required');
    expect(html).toContain('Load a model in your local Lemonade Server first');
    for (const identifier of [
      'chk-lemonade',
      'Lemonade',
      'openai-compatible',
      'http://localhost:13305/api/v1',
    ]) {
      expect(html).toContain(identifier);
    }
  });

  it.each([
    ['zh', '未找到匹配的提供商', '暂无匹配的提供商', '请从左侧选择一个提供商'],
    [
      'en',
      'No matching providers',
      'No matching providers',
      'Select a provider on the left',
    ],
  ] as const)(
    'renders chooser and provider-list empty states in %s',
    (locale, noCatalogMatches, noListMatches, noSelection) => {
      state.locale = locale;
      const catalog = AVAILABLE_PROVIDERS_CATALOG.splice(0);
      try {
        expect(renderToStaticMarkup(chooser())).toContain(noCatalogMatches);
        const html = renderToStaticMarkup(createElement(AiModelSettings));
        expect(html).toContain(noListMatches);
        expect(html).toContain(noSelection);
      } finally {
        AVAILABLE_PROVIDERS_CATALOG.push(...catalog);
      }
    },
  );

  it('uses the current locale for chooser update errors without changing the repository detail or provider ID', async () => {
    const diagnostic = '保存失败 (provider-repo/v2: write rejected)';
    state.setVisibility.mockRejectedValue(new Error(diagnostic));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderToStaticMarkup(chooser());
      const toggleLemonade = state.checkboxActions.get('chk-lemonade');
      expect(toggleLemonade).toBeDefined();
      const toggle = toggleLemonade?.(false);
      state.locale = 'en';
      await toggle;
      expect(state.setVisibility).toHaveBeenCalledWith('Lemonade', false);
      expect(state.toastError).toHaveBeenCalledWith(
        'Could not update the provider',
        {
          description: diagnostic,
        },
      );
    } finally {
      log.mockRestore();
    }
  });
});
