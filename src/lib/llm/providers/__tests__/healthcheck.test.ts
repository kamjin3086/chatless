import { describe, expect, it } from 'vitest';
import { classifyNetworkError, judgeApiReachable } from '../healthcheck';

describe('judgeApiReachable', () => {
  it('treats 502/503/504 as unreachable even though HTTP came back', () => {
    expect(judgeApiReachable(502, 'Bad Gateway').ok).toBe(false);
    expect(judgeApiReachable(503, 'Service Unavailable').ok).toBe(false);
    expect(judgeApiReachable(504, 'Gateway Timeout').reason).toBe('NETWORK');
  });

  it('treats HTML gateway pages as unreachable', () => {
    const html = '<!DOCTYPE html><html><body>nginx</body></html>';
    expect(judgeApiReachable(200, html, 'text/html').ok).toBe(false);
    expect(judgeApiReachable(404, html).ok).toBe(false);
  });

  it('treats connection-style status 0 as unreachable', () => {
    expect(judgeApiReachable(0, '').ok).toBe(false);
    expect(judgeApiReachable(0, '').reason).toBe('NETWORK');
  });

  it('treats OpenAI-style 401 as reachable API', () => {
    const body = JSON.stringify({ error: { message: 'Incorrect API key', type: 'invalid_request_error' } });
    const judged = judgeApiReachable(401, body, 'application/json');
    expect(judged.ok).toBe(true);
  });

  it('treats /models JSON list as reachable', () => {
    const body = JSON.stringify({ object: 'list', data: [{ id: 'gpt-4' }] });
    expect(judgeApiReachable(200, body, 'application/json').ok).toBe(true);
  });

  it('treats 400 JSON from chat completions as reachable', () => {
    const body = JSON.stringify({ error: { message: 'model not found' } });
    expect(judgeApiReachable(400, body, 'application/json').ok).toBe(true);
  });

  it('treats bare 404 without API JSON as wrong path', () => {
    const judged = judgeApiReachable(404, 'Not Found');
    expect(judged.ok).toBe(false);
    expect(judged.message).toMatch(/路径/);
  });
});

describe('classifyNetworkError', () => {
  it('maps Windows connection refused to NETWORK', () => {
    const result = classifyNetworkError(
      new Error('error trying to connect: tcp connect error: 由于目标计算机积极拒绝，无法连接。 (os error 10061)'),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('NETWORK');
  });

  it('maps timeouts', () => {
    expect(classifyNetworkError(new Error('request timeout')).reason).toBe('TIMEOUT');
  });
});
