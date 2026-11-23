import { describe, expect, it } from 'vitest';
import { formatConnectionCheckMessage, translateConnectionCheckMessage } from '@/lib/provider/formatConnectionCheckMessage';

describe('formatConnectionCheckMessage', () => {
  it('rewrites HTTP 502 technical text', () => {
    expect(formatConnectionCheckMessage('zh', 'HTTP 502 - 服务器响应错误')).toBe('请确认服务已启动');
    expect(formatConnectionCheckMessage('zh', '无法连接 HTTP 502 - 服务器响应错误')).toBe('请确认服务已启动');
  });

  it('does not leak HTTP status or OS errors', () => {
    const out = formatConnectionCheckMessage('zh', 'HTTP 503 Service Unavailable');
    expect(out).not.toMatch(/HTTP/i);
    expect(out).not.toMatch(/503/);
    expect(formatConnectionCheckMessage('zh', 'os error 10061')).not.toMatch(/10061/);
  });

  it('keeps already friendly copy', () => {
    expect(formatConnectionCheckMessage('zh', '请检查服务是否启动以及地址和端口')).toBe(
      '请检查服务是否启动以及地址和端口',
    );
  });

  it('maps timeout and refused connections', () => {
    expect(formatConnectionCheckMessage('zh', '连接超时（8秒内无响应）')).toBe('连接超时，请稍后重试');
    expect(formatConnectionCheckMessage('zh', '连接被拒绝 - 请检查服务器是否运行在端口6434')).toBe(
      '连接被拒绝，请确认服务已启动',
    );
    expect(formatConnectionCheckMessage('zh', '服务无响应，请确认后端已启动')).toBe('请确认服务已启动');
  });

  it('returns null for empty input', () => {
    expect(formatConnectionCheckMessage('zh', null)).toBeNull();
    expect(formatConnectionCheckMessage('zh', '   ')).toBeNull();
  });
});


describe('Provider connection copy in English', () => {
  it.each([
    ['HTTP 401 Unauthorized', 'The API key is invalid or lacks permission'],
    ['HTTP 404 Not Found', 'The endpoint URL is incorrect'],
    ['HTTP 429 Too Many Requests', 'Too many requests. Try again later.'],
    ['HTTP 502 - 服务器响应错误', 'Make sure the service is running'],
    ['连接超时（8秒内无响应）', 'The connection timed out. Try again later.'],
    ['ENOTFOUND', 'Could not resolve the address. Check the service URL.'],
    ['os error 10061', 'Connection refused. Make sure the service is running.'],
    ['未配置服务地址', 'No service URL configured'],
  ])('renders a friendly hint for %s', (message, hint) => {
    expect(formatConnectionCheckMessage('en', message)).toBe(hint);
  });

  it('localizes known check toasts without changing upstream diagnostic details', () => {
    const reachable = '接口可访问，密钥请使用时再确认';
    expect(translateConnectionCheckMessage('en', reachable)).toBe(
      'The endpoint is reachable, but the API key has not been verified',
    );
    expect(translateConnectionCheckMessage('zh', reachable)).toBe(reachable);
    const upstream = 'HTTP 502  /models: 请求未转发 (gateway-7)';
    expect(translateConnectionCheckMessage('en', upstream)).toBe(upstream);
    expect(translateConnectionCheckMessage('zh', upstream)).toBe(upstream);
    expect(formatConnectionCheckMessage('en', 'Vendor XYZ: 请求未转发')).toBe(
      'Vendor XYZ: 请求未转发',
    );
  });
});
