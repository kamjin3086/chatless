import React, { createElement, type PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderWithStatus } from '@/hooks/useProviderManagement';
import type { Locale } from '@/i18n/types';
import { AiModelSettings, MobileProviderRow } from '../AiModelSettings';

const state = vi.hoisted(() => ({ locale: 'zh' as Locale }));

vi.stubGlobal('React', React);

// Server rendering cannot read the client store snapshot or mount Radix portals.
vi.mock('@/store/localeStore', () => {
  const getState = () => ({ locale: state.locale });
  const useLocaleStore = (
    selector: (snapshot: ReturnType<typeof getState>) => unknown,
  ) => selector(getState());
  return { useLocaleStore: Object.assign(useLocaleStore, { getState }) };
});
vi.mock('../useStableProviderIcon', () => ({
  useStableProviderIcon: () => ({ iconSrc: '/provider-icon.svg' }),
}));
vi.mock('@/hooks/useProviderManagement', () => ({
  useProviderManagement: () => ({ providers: [], isLoading: false }),
}));
vi.mock('../ProviderSettings', () => ({ ProviderSettings: () => null }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));
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
  Checkbox: ({ id }: { id: string }) =>
    createElement('input', { id, type: 'checkbox' }),
}));
vi.mock('@/components/ui/sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/provider/ProviderRepository', () => ({
  providerRepository: { setVisibility: vi.fn() },
}));

const provider = (over: Partial<ProviderWithStatus>): ProviderWithStatus =>
  ({
    name: 'x',
    displayName: 'X',
    api_base_url: 'http://localhost:1234/v1',
    requiresApiKey: false,
    models: [],
    ...over,
  }) as ProviderWithStatus;

const row = (p: ProviderWithStatus, inUse: boolean) =>
  renderToStaticMarkup(
    createElement(MobileProviderRow, { provider: p, inUse, onOpen: () => {} }),
  );

describe('mobile model-service list', () => {
  beforeEach(() => {
    state.locale = 'zh';
  });

  // 这个组件把整个 props 包都默认了（`(props = {})`），createElement 的重载会把它读成
  // 不收 props 的组件；这里把那个包写明确，给类型检查看。
  const CompactSettings = AiModelSettings as unknown as React.FC<{
    compact?: boolean;
  }>;

  it.each([
    ['zh', '模型服务', '刷新状态'],
    ['en', 'Providers', 'Refresh status'],
  ] as const)(
    'opens on the service list, not a dropdown, in %s',
    (locale, heading, refresh) => {
      state.locale = locale;
      const html = renderToStaticMarkup(
        createElement(CompactSettings, { compact: true }),
      );
      // 服务是列表里的行，不是一个下拉。
      expect(html).toContain('<ul');
      expect(html).not.toContain('<select');
      expect(html).toContain(heading);
      expect(html).toContain(refresh);
      // 手机不接 adb 时，右下角这个按钮是把日志带出手机的唯一入口。
      expect(html).toContain(locale === 'zh' ? '日志导出' : 'Export logs');
    },
  );

  it('keeps the log button off the desktop page', () => {
    const desktop = renderToStaticMarkup(createElement(AiModelSettings));
    expect(desktop).not.toContain('日志导出');
    expect(desktop).not.toContain('Export logs');
  });

  it.each([
    [
      'zh',
      '使用中',
      '连接正常',
      '未配置密钥',
      '未检查',
      '2 个模型',
      '1 个模型',
    ],
    [
      'en',
      'In use',
      'Connected',
      'No API key set',
      'Unchecked',
      '2 models',
      '1 model',
    ],
  ] as const)(
    'says what each service is doing in %s, in the detail page words',
    (locale, inUse, connected, noKey, unchecked, twoModels, oneModel) => {
      state.locale = locale;
      expect(
        row(
          provider({
            name: 'lm',
            displayName: 'LM Studio',
            lastResult: 'CONNECTED',
          }),
          true,
        ),
      ).toMatch(new RegExp(`${inUse}.*${connected}`, 's'));
      const noKeyRow = row(
        provider({
          name: 'cloud',
          displayName: 'Cloud',
          configStatus: 'NO_KEY',
          models: [{ name: 'a' }, { name: 'b' }] as never[],
        }),
        false,
      );
      expect(noKeyRow).toContain(noKey);
      expect(noKeyRow).toContain(twoModels);
      expect(
        row(provider({ name: 'fresh', displayName: 'Fresh' }), false),
      ).toContain(unchecked);
      expect(
        row(
          provider({
            name: 'solo',
            displayName: 'Solo',
            lastResult: 'CONNECTED',
            models: [{ name: 'm' }] as never[],
          }),
          false,
        ),
      ).toContain(oneModel);
      // 没用上的服务不该带着「使用中」的标记。
      expect(
        row(provider({ name: 'other', displayName: 'Other' }), false),
      ).not.toContain(inUse);
    },
  );
});
