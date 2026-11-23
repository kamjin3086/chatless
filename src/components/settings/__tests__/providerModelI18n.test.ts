import React, {
  createElement,
  type MouseEventHandler,
  type PropsWithChildren,
  type ReactElement,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelParametersDialog } from '@/components/chat/ModelParametersDialog';
import type { ProviderWithStatus } from '@/hooks/useProviderManagement';
import { translate } from '@/i18n';
import type { Locale, TranslationKey } from '@/i18n/types';
import type { ModelMetadata } from '@/lib/metadata/types';
import type { ModelCheckResult } from '@/store/modelCheckStore';
import { ProviderModelList } from '../ProviderModelList';
import { ProviderStrategySelector } from '../ProviderStrategySelector';
import { formatProviderModelStrategyUpdate } from '../providerModelPresentation';

const state = vi.hoisted(() => ({
  locale: 'zh' as Locale,
  lastCheck: undefined as ModelCheckResult | undefined,
  probe: vi.fn(),
  recordCheck: vi.fn(),
  runCheck: undefined as MouseEventHandler<HTMLButtonElement> | undefined,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.stubGlobal('React', React);

vi.mock('@/store/localeStore', () => {
  const getState = () => ({ locale: state.locale });
  const useLocaleStore = (
    selector: (snapshot: ReturnType<typeof getState>) => unknown,
  ) => selector(getState());
  return { useLocaleStore: Object.assign(useLocaleStore, { getState }) };
});
vi.mock('@/store/modelCheckStore', () => ({
  useModelCheckStore: (select: (snapshot: unknown) => unknown) =>
    select({ getResult: () => state.lastCheck, setResult: state.recordCheck }),
}));
vi.mock('@/lib/storage', () => ({ specializedStorage: {} }));
vi.mock('@/lib/llm/modelProbe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/llm/modelProbe')>()),
  probeModel: state.probe,
}));
vi.mock('@/components/ui/sonner', () => ({
  toast: { error: state.toastError, success: state.toastSuccess },
}));

// Render the children of Radix portals so SSR can check the actual component copy.
vi.mock('@/components/ui/dialog', () => {
  const inline = ({ children }: PropsWithChildren) => children;
  return {
    Dialog: inline,
    DialogContent: inline,
    DialogHeader: inline,
    DialogTitle: inline,
    DialogDescription: inline,
    DialogTrigger: inline,
    DialogFooter: inline,
  };
});
vi.mock('@/components/ui/select', () => {
  const inline = ({ children }: PropsWithChildren) => children;
  return {
    Select: inline,
    SelectContent: inline,
    SelectTrigger: inline,
    SelectItem: ({ children, value }: PropsWithChildren<{ value: string }>) =>
      createElement('span', { 'data-value': value }, children),
    SelectValue: ({ placeholder }: { placeholder: string }) => placeholder,
  };
});
vi.mock('@/components/ui/dropdown-menu', () => {
  const inline = ({ children }: PropsWithChildren) => children;
  return {
    DropdownMenu: inline,
    DropdownMenuContent: inline,
    DropdownMenuItem: inline,
    DropdownMenuLabel: inline,
    DropdownMenuSeparator: () => null,
    DropdownMenuTrigger: inline,
    DropdownMenuSub: inline,
    DropdownMenuSubContent: inline,
    DropdownMenuSubTrigger: inline,
  };
});
vi.mock('@/components/ui/alert-dialog', () => {
  const inline = ({ children }: PropsWithChildren) => children;
  return {
    AlertDialog: inline,
    AlertDialogAction: inline,
    AlertDialogCancel: inline,
    AlertDialogContent: inline,
    AlertDialogDescription: inline,
    AlertDialogFooter: inline,
    AlertDialogHeader: inline,
    AlertDialogTitle: inline,
    AlertDialogTrigger: inline,
  };
});
vi.mock('@/components/ui/tooltip', () => {
  const inline = ({ children }: PropsWithChildren) => children;
  return {
    Tooltip: inline,
    TooltipContent: inline,
    TooltipProvider: inline,
    TooltipTrigger: ({
      children,
    }: {
      children: ReactElement<{
        'aria-label'?: string;
        onClick?: MouseEventHandler<HTMLButtonElement>;
      }>;
    }) => {
      if (children.props.onClick && children.props['aria-label']) {
        state.runCheck = children.props.onClick;
      }
      return children;
    },
  };
});

const provider: ProviderWithStatus = {
  name: 'ProviderFixture',
  api_base_url: 'https://example.com/v1',
  requiresApiKey: true,
  configStatus: 'NO_KEY',
  displayStatus: 'NO_KEY',
  models: [],
};
const model: ModelMetadata = {
  name: 'vendor/deploy-17',
  label: '自定义模型 $&',
  aliases: ['vendor/deploy-17'],
};
const noop = () => {};
const renderList = (
  modelsForDisplay: ModelMetadata[] = [model],
  modelSearch = '',
  currentProvider = provider,
) =>
  renderToStaticMarkup(
    createElement(ProviderModelList, {
      provider: currentProvider,
      modelsForDisplay,
      modelSearch,
      setModelSearch: noop,
      showApiKeyFields: true,
      localModelApiKeys: { [model.name]: 'never-render-this-key' },
      setLocalModelApiKeys: noop,
      onModelApiKeyChange: noop,
      onModelApiKeyBlur: noop,
      onOpenParameters: noop,
    }),
  );

beforeEach(() => {
  state.locale = 'zh';
  state.runCheck = undefined;
  state.lastCheck = undefined;
  vi.resetAllMocks();
});

describe('Provider model settings i18n', () => {
  it.each([
    [
      'zh',
      '添加模型',
      '删除该行',
      '刷新模型列表',
      '仅显示支持视觉的模型',
      '未归类',
      '1 个模型',
      '重命名模型',
      '确认删除该模型？',
    ],
    [
      'en',
      'Add models',
      'Remove this row',
      'Refresh model list',
      'Show only vision models',
      'Uncategorized',
      '1 model',
      'Rename model',
      'Delete this model?',
    ],
  ] as const)(
    'renders manual add, list controls, and model actions in %s without translating IDs or exposing model API keys',
    (
      locale,
      add,
      removeRow,
      refresh,
      vision,
      uncategorized,
      count,
      rename,
      deleteTitle,
    ) => {
      state.locale = locale;
      const html = renderList();
      for (const text of [
        add,
        refresh,
        vision,
        uncategorized,
        count,
        rename,
        deleteTitle,
      ]) {
        expect(html).toContain(text);
      }
      expect(html).toContain(`aria-label="${removeRow}"`);
      expect(html).toContain(`title="${model.name}"`);
      expect(html).toContain('自定义模型 $&amp;');
      expect(html).toContain('gemini-2.5-pro');
      expect(html).toContain('data-value="default"');
      expect(html).toContain('data-value="auto"');
      expect(html).toContain(
        'data-value="openai-compatible">OpenAI Compatible (/v1/chat/completions)',
      );
      expect(html).not.toContain('never-render-this-key');
    },
  );

  it.each([
    [
      'zh',
      '填写密钥后可拉取模型，也可手动添加',
      '暂无模型，可刷新列表或手动添加',
      '筛选模型',
      '没有符合筛选条件的模型',
    ],
    [
      'en',
      'Enter an API key to fetch models, or add them manually.',
      'No models yet. Refresh the list or add models manually.',
      'Filter models',
      'No models match these filters',
    ],
  ] as const)(
    'renders the distinct model list empty states in %s',
    (locale, needsKey, noModels, filter, noMatch) => {
      state.locale = locale;
      expect(renderList([])).toContain(needsKey);
      expect(
        renderList([], '', { ...provider, displayStatus: undefined }),
      ).toContain(noModels);
      const filtered = renderList([model], 'no such model');
      expect(filtered).toContain(`placeholder="${filter}"`);
      expect(filtered).toContain(noMatch);
      expect(filtered).not.toContain(model.name);
    },
  );

  it('uses the current locale for an in-flight check without translating, classifying differently, or replacing the provider diagnostic', async () => {
    const diagnostic = '401 原始响应 $& from fixture/v1';
    state.probe.mockResolvedValue({
      ok: false,
      status: 'failed',
      message: diagnostic,
      durationMs: 17,
    });
    renderList();
    expect(state.runCheck).toBeDefined();
    state.runCheck?.({ preventDefault: noop } as Parameters<
      NonNullable<typeof state.runCheck>
    >[0]);
    state.locale = 'en';
    await vi.waitFor(() => {
      expect(state.toastError).toHaveBeenCalledWith('Model unavailable', {
        description: `${diagnostic} · Authentication failed. Check that your API key is valid and has access. · Duration: 17 ms`,
        duration: 6000,
      });
    });
    expect(state.probe).toHaveBeenCalledWith(provider.name, model.name);
    expect(state.recordCheck).toHaveBeenCalledWith(
      provider.name,
      model.name,
      expect.objectContaining({ message: diagnostic, ok: false }),
    );
    state.lastCheck = {
      ok: false,
      message: diagnostic,
      durationMs: 17,
      timestamp: 0,
    };
    const html = renderList();
    expect(html).toContain('Result: Unavailable');
    expect(html).toContain('401 原始响应 $&amp; from fixture/v1');
  });

  it('localizes a previously saved first-party probe note without rendering it as an error', () => {
    state.locale = 'en';
    state.lastCheck = {
      ok: true,
      durationMs: 17,
      note: '回答在 8 tokens 上限处截断，端点已回包',
      timestamp: 0,
    };
    const html = renderList();
    expect(html).toContain('Result: Available');
    expect(html).toContain(
      'The endpoint responded, but the reply reached the 8-token probe limit.',
    );
  });

  it('localizes provider default strategy and model parameter controls, not strategy values or user model labels', () => {
    state.locale = 'en';
    const strategy = renderToStaticMarkup(
      createElement(ProviderStrategySelector, {
        providerName: provider.name,
        value: 'openai-compatible',
        onChange: noop,
      }),
    );
    expect(strategy).toContain('Default request strategy');
    expect(strategy).toContain(
      'data-value="__auto__">Infer strategy from model ID',
    );
    expect(strategy).toContain(
      'data-value="openai-responses">OpenAI Responses (/v1/responses)',
    );
    const dialog = renderToStaticMarkup(
      createElement(ModelParametersDialog, {
        open: true,
        onOpenChange: noop,
        providerName: provider.name,
        modelId: model.name,
        modelLabel: model.label,
      }),
    );
    expect(dialog).toContain('Model parameters');
    expect(dialog).toContain(
      'These defaults apply to all chats using this model.',
    );
    expect(dialog).toContain('Clear model parameters');
    expect(dialog).toContain('自定义模型 $&amp;');
  });

  it('formats singular, plural, and skipped model counts without leaving template placeholders', () => {
    const en = (key: TranslationKey) => translate('en', key);
    const zh = (key: TranslationKey) => translate('zh', key);
    expect(formatProviderModelStrategyUpdate(en, 1)).toBe(
      'Strategy set for 1 model',
    );
    expect(formatProviderModelStrategyUpdate(en, 0, 2)).toBe(
      'Strategy set for 0 models; skipped 2 models with no match',
    );
    expect(formatProviderModelStrategyUpdate(zh, 2, 1)).toBe(
      '已为 2 个模型 设置策略，已跳过未匹配的 1 个模型',
    );
  });
});
