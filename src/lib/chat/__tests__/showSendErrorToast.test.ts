import { describe, expect, it } from 'vitest';
import { formatSendError } from '@/lib/chat/showSendErrorToast';

describe('formatSendError', () => {
  it('explains HTTP 502 as unreachable service', () => {
    const info = formatSendError(new Error('HTTP 502 Bad Gateway'));
    expect(info.isNetwork).toBe(true);
    expect(info.openProviderSettings).toBe(true);
    expect(info.title).toBe('模型服务访问不通');
    expect(info.description).not.toMatch(/HTTP 502/i);
    expect(info.description).not.toMatch(/输入框/);
    expect(info.description).toMatch(/服务是否启动/);
  });

  it('detects network unreachable errors', () => {
    const info = formatSendError(new Error('Failed to fetch'));
    expect(info.isNetwork).toBe(true);
    expect(info.openProviderSettings).toBe(true);
    expect(info.title).toBe('模型服务访问不通');
  });

  it('explains missing API key', () => {
    const err = new Error('NO_KEY');
    (err as any).userMessage = '未配置 API 密钥，请前往设置';
    const info = formatSendError(err);
    expect(info.openProviderSettings).toBe(true);
    expect(info.title).toContain('密钥');
  });

  it('detects connection refused', () => {
    const info = formatSendError(new Error('ECONNREFUSED 127.0.0.1:13305'));
    expect(info.isNetwork).toBe(true);
    expect(info.openProviderSettings).toBe(true);
  });
});
