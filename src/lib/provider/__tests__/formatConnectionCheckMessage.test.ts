import { describe, expect, it } from 'vitest';
import { formatConnectionCheckMessage } from '@/lib/provider/formatConnectionCheckMessage';

describe('formatConnectionCheckMessage', () => {
  it('rewrites HTTP 502 technical text', () => {
    expect(formatConnectionCheckMessage('HTTP 502 - 服务器响应错误')).toBe('请确认服务已启动');
    expect(formatConnectionCheckMessage('无法连接 HTTP 502 - 服务器响应错误')).toBe('请确认服务已启动');
  });

  it('does not leak HTTP status or OS errors', () => {
    const out = formatConnectionCheckMessage('HTTP 503 Service Unavailable');
    expect(out).not.toMatch(/HTTP/i);
    expect(out).not.toMatch(/503/);
    expect(formatConnectionCheckMessage('os error 10061')).not.toMatch(/10061/);
  });

  it('keeps already friendly copy', () => {
    expect(formatConnectionCheckMessage('请检查服务是否启动以及地址和端口')).toBe(
      '请检查服务是否启动以及地址和端口',
    );
  });

  it('maps timeout and refused connections', () => {
    expect(formatConnectionCheckMessage('连接超时（8秒内无响应）')).toBe('连接超时，请稍后重试');
    expect(formatConnectionCheckMessage('连接被拒绝 - 请检查服务器是否运行在端口6434')).toBe(
      '连接被拒绝，请确认服务已启动',
    );
    expect(formatConnectionCheckMessage('服务无响应，请确认后端已启动')).toBe('请确认服务已启动');
  });

  it('returns null for empty input', () => {
    expect(formatConnectionCheckMessage(null)).toBeNull();
    expect(formatConnectionCheckMessage('   ')).toBeNull();
  });
});
