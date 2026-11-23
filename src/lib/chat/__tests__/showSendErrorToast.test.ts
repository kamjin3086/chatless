import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/components/ui/sonner';
import type { Locale } from '@/i18n/types';
import {
  formatSendError,
  showSendErrorToast,
} from '@/lib/chat/showSendErrorToast';
import { useLocaleStore } from '@/store/localeStore';

vi.mock('@/components/ui/sonner', () => ({ toast: { error: vi.fn() } }));

const locales = ['zh', 'en'] as const satisfies readonly Locale[];

describe('formatSendError', () => {
  it.each([
    ['zh', '模型服务访问不通', '请检查服务是否启动，以及地址和端口。'],
    [
      'en',
      'Could not reach the model service',
      'Check whether the service is running and verify its address and port.',
    ],
  ] as const)(
    'explains HTTP 502 as unreachable service in %s',
    (locale, title, description) => {
      expect(
        formatSendError(new Error('HTTP 502 Bad Gateway'), locale),
      ).toEqual({
        title,
        description,
        isNetwork: true,
        openProviderSettings: true,
      });
    },
  );

  it.each(['Failed to fetch', 'ECONNREFUSED 127.0.0.1:13305'])(
    'detects network failure: %s',
    (message) => {
      for (const locale of locales) {
        expect(formatSendError(new Error(message), locale)).toMatchObject({
          isNetwork: true,
          openProviderSettings: true,
        });
      }
    },
  );

  it.each([
    [
      Object.assign(new Error('Missing key'), { code: 'NO_KEY' }),
      '未配置 API 密钥',
      'API key not configured',
      true,
    ],
    [new Error('NO_KEY'), '未配置 API 密钥', 'API key not configured', true],
    [
      new Error('HTTP 401 Unauthorized'),
      '密钥无效或没有权限',
      'Invalid API key or insufficient permissions',
      true,
    ],
    [
      new Error('HTTP 403 Forbidden'),
      '密钥无效或没有权限',
      'Invalid API key or insufficient permissions',
      true,
    ],
    [
      new Error('HTTP 404 Not Found'),
      '接口地址不正确',
      'Incorrect API endpoint',
      true,
    ],
    [
      new Error('HTTP 429 Too Many Requests'),
      '请求过于频繁',
      'Too many requests',
      false,
    ],
    [
      new Error('Unexpected problem'),
      '发送失败',
      'Could not send message',
      true,
    ],
  ] as const)(
    'preserves the classification of %s across locales',
    (error, zh, en, openProviderSettings) => {
      const titles = { zh, en };
      for (const locale of locales) {
        expect(formatSendError(error, locale)).toMatchObject({
          title: titles[locale],
          isNetwork: false,
          openProviderSettings,
        });
      }
    },
  );

  it.each([
    ['zh', '模型拒绝了这次请求'],
    ['en', 'The model rejected the request'],
  ] as const)(
    "preserves the provider's own reason for a rejected request in %s",
    (locale, title) => {
      const reason = "message 5 has role 'system' after a non-system turn";
      const error = new Error(
        `HTTP 400 Bad Request: ${JSON.stringify({ error: { message: reason } })}`,
      );

      expect(formatSendError(error, locale)).toEqual({
        title,
        description: reason,
        isNetwork: false,
        openProviderSettings: false,
      });
    },
  );
});

describe('showSendErrorToast', () => {
  const { locale: initialLocale } = useLocaleStore.getState();

  afterEach(() => {
    useLocaleStore.setState({ locale: initialLocale });
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses the locale at each call and keeps the provider settings destination', () => {
    const error = new Error('HTTP 404 Not Found');
    const providerName = 'Local Model';
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });

    useLocaleStore.setState({ locale: 'en' });
    showSendErrorToast(error, { providerName });
    expect(toast.error).toHaveBeenLastCalledWith('Incorrect API endpoint', {
      description: 'Check the service address and path.',
      duration: 8000,
      action: { label: 'Configure provider', onClick: expect.any(Function) },
    });
    vi.mocked(toast.error).mock.lastCall?.[1]?.action?.onClick();
    expect(assign).toHaveBeenCalledWith(
      '/settings?tab=localModels&provider=Local+Model',
    );

    useLocaleStore.setState({ locale: 'zh' });
    showSendErrorToast(error, { providerName });
    expect(toast.error).toHaveBeenLastCalledWith('接口地址不正确', {
      description: '请核对服务地址和路径。',
      duration: 8000,
      action: { label: '去配置', onClick: expect.any(Function) },
    });
  });

  it('shows wait-and-retry guidance without a settings action for rate limiting', () => {
    useLocaleStore.setState({ locale: 'en' });
    showSendErrorToast(new Error('HTTP 429 Too Many Requests'));

    expect(toast.error).toHaveBeenCalledWith('Too many requests', {
      description: 'Wait a moment and try again.',
      duration: 8000,
      action: undefined,
    });
  });
});
