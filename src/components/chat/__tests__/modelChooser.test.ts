import React, { createElement } from 'react';
import type { ComponentProps, MouseEvent, PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Locale } from '@/i18n/types';
import type { ProviderMetadata } from '@/lib/metadata/types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ModelList } from '../ModelList';
import { ModelSelectContent } from '../ModelSelectContent';
import { ModelSelector } from '../ModelSelector';
import { RecentModelsList } from '../RecentModelsList';

const mocks = vi.hoisted(() => ({
  locale: 'zh' as Locale,
  getMetadata: vi.fn(),
  setProviderList: vi.fn(),
  setLastSelectedModelPair: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/store/localeStore', () => {
  const getState = () => ({ locale: mocks.locale });
  return {
    useLocaleStore: Object.assign(
      (selector: (state: ReturnType<typeof getState>) => Locale) =>
        selector(getState()),
      { getState },
    ),
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/metadata/MetadataService', () => ({
  metadataService: { get: mocks.getMetadata },
}));
vi.mock('@/lib/storage', () => ({
  specializedStorage: {
    models: { setLastSelectedModelPair: mocks.setLastSelectedModelPair },
  },
}));
vi.mock('@/store/providerMetaStore', () => ({
  useProviderMetaStore: {
    getState: () => ({ setList: mocks.setProviderList }),
  },
}));
vi.mock('@/components/ui/sonner', () => ({ toast: mocks.toast }));
vi.mock('../ModelParametersDialog', () => ({
  ModelParametersDialog: () => null,
}));

// Render the portalled copy in Node while keeping the chooser components and tabs real.
vi.mock('@/components/ui/select', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/select')>()),
  SelectContent: ({ children }: PropsWithChildren) =>
    createElement('div', {}, children),
  SelectGroup: ({ children }: PropsWithChildren) =>
    createElement('div', {}, children),
  SelectItem: ({ children, value }: PropsWithChildren<{ value: string }>) =>
    createElement('div', { 'data-model-value': value }, children),
}));
vi.mock('@/components/ui/tooltip', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/tooltip')>()),
  TooltipContent: ({ children }: PropsWithChildren) =>
    createElement('div', {}, children),
}));
vi.mock('../ModelSelectContent', async (importOriginal) => {
  const { ModelSelectContent } =
    await importOriginal<typeof import('../ModelSelectContent')>();
  return { ModelSelectContent: vi.fn(ModelSelectContent) };
});

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.resetAllMocks();
  mocks.locale = 'zh';
});

const model = { name: 'Model-$&-V1', label: 'My model label', aliases: [] };
const provider: ProviderMetadata = {
  name: 'Provider-Custom',
  displayName: 'My provider label',
  api_base_url: 'http://localhost',
  requiresApiKey: false,
  models: [model],
};

function renderSelector(
  allMetadata: ProviderMetadata[] = [],
  currentModelId: string | null = null,
) {
  return renderToStaticMarkup(
    createElement(ModelSelector, {
      currentModelId,
      allMetadata,
      onModelChange: vi.fn(),
    }),
  );
}

function renderContent(searchQuery: string) {
  return renderToStaticMarkup(
    createElement(ModelSelectContent, {
      filteredModels: [],
      recentModelDetails: [],
      globalDefaultModel: null,
      currentModelId: null,
      searchQuery,
      setSearchQuery: vi.fn(),
      onSetDefault: vi.fn(),
      onOpenChange: vi.fn(),
      onRefresh: vi.fn(),
    }),
  );
}

function selectorContentProps(): ComponentProps<typeof ModelSelectContent> {
  renderSelector([provider]);
  const props = vi.mocked(ModelSelectContent).mock.lastCall?.[0];
  if (!props)
    throw new Error('ModelSelector did not render ModelSelectContent');
  return props;
}

describe('chat model chooser locale', () => {
  it('renders trigger, tab, and accessible search action copy in the selected language', () => {
    const zh = renderContent('missing');
    expect(zh).toContain('aria-label="搜索模型或提供商…"');
    expect(zh).toContain('aria-label="清除搜索"');
    expect(zh).toContain('aria-label="设置 AI 模型"');
    expect(zh).toContain('全部模型');
    expect(zh).toContain('最近使用');
    expect(renderSelector([provider])).toContain('aria-label="选择模型"');

    mocks.locale = 'en';
    const en = renderContent('missing');
    expect(en).toContain('placeholder="Search models or providers"');
    expect(en).toContain('aria-label="Search models or providers"');
    expect(en).toContain('aria-label="Clear search"');
    expect(en).toContain('aria-label="Model settings"');
    expect(en).toContain('All models');
    expect(en).toContain('Recent models');
    expect(renderSelector([provider])).toContain('aria-label="Choose model"');
    expect(renderSelector([provider], model.name)).toContain(
      'aria-label="My model label · My provider label"',
    );
  });

  it('distinguishes localized loading, unmatched search, and empty recent copy', () => {
    const recent = () =>
      renderToStaticMarkup(
        createElement(RecentModelsList, {
          recentModelDetails: [],
          globalDefaultModel: null,
          currentModelId: null,
          onSetDefault: vi.fn(),
        }),
      );
    expect(renderContent('')).toContain('正在加载模型列表…');
    expect(renderContent('missing')).toContain('无匹配结果');
    expect(recent()).toContain('暂无最近使用模型');

    mocks.locale = 'en';
    expect(renderSelector()).toContain('aria-label="Loading…"');
    expect(renderContent('')).toContain('Loading models…');
    const unmatched = renderContent('missing');
    expect(unmatched).toContain('No matching models');
    expect(unmatched).toContain('Try a different search term');
    expect(unmatched).not.toContain('Loading models…');
    expect(recent()).toContain('No recently used models');
  });

  it('keeps provider and model data verbatim while translating the ID label', () => {
    const renderModelList = () =>
      renderToStaticMarkup(
        createElement(
          TooltipProvider,
          null,
          createElement(ModelList, {
            models: [provider],
            globalDefaultModel: null,
            currentModelId: null,
            searchQuery: 'Model-',
            onSetDefault: vi.fn(),
          }),
        ),
      );
    expect(renderModelList()).toContain('模型 ID');
    mocks.locale = 'en';
    const en = renderModelList();
    expect(en).toContain('Model ID');
    expect(en).toContain('My model label');
    expect(en).toContain('My provider label');
    expect(en).toContain('data-model-value="Provider-Custom::Model-$&amp;-V1"');
  });

  it('keeps the model ID literal when it appears in a localized default-model toast', async () => {
    mocks.locale = 'en';
    const { onSetDefault } = selectorContentProps();
    const event = {
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    } as unknown as MouseEvent;
    await onSetDefault(event, provider.name, model.name);
    expect(mocks.setLastSelectedModelPair).toHaveBeenCalledWith(
      provider.name,
      model.name,
    );
    expect(mocks.toast.success).toHaveBeenCalledWith(
      'Model-$&-V1 set as the default model',
    );
  });

  it('localizes refresh feedback at completion without replacing the logged error', async () => {
    const { onRefresh } = selectorContentProps();
    mocks.getMetadata.mockReturnValueOnce([provider]);
    await onRefresh();
    expect(mocks.setProviderList).toHaveBeenCalledWith([provider]);
    expect(mocks.toast.success).toHaveBeenCalledWith('模型列表已刷新');

    const providerError = new Error('Provider-Custom: HTTP 503');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      mocks.getMetadata.mockImplementationOnce(() => {
        throw providerError;
      });
      const refresh = onRefresh();
      mocks.locale = 'en';
      await refresh;
      expect(mocks.toast.error).toHaveBeenCalledWith(
        'Could not refresh the model list',
      );
      expect(consoleError).toHaveBeenCalledWith(
        '刷新模型列表失败',
        providerError,
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
