import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeepSeekProvider } from '../DeepSeekProvider';
import { OpenAICompatibleProvider } from '../OpenAICompatibleProvider';

const mock = vi.hoisted(() => ({ connect: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/sse-client', () => ({ SSEClient: class {
  startConnection = mock.connect;
  stopConnection = vi.fn();
} }));
vi.mock('@/lib/request', () => ({ tauriFetch: mock.fetch }));
vi.mock('../thinking', () => ({ ThinkingStrategyFactory: {
  createDeepSeekStrategy: () => ({ reset: vi.fn(), processToken: () => ({ events: [] }) }),
  createStandardStrategy: () => ({ reset: vi.fn(), processToken: () => ({ events: [] }) }),
} }));

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllGlobals());
const delta = (value: unknown, finish_reason: string | null = null) => JSON.stringify({ choices: [{ delta: value, finish_reason }] });
const call = { tool_calls: [{ index: 0, id: 'a', function: { name: 'fs__write', arguments: '{"path":"a"}' } }] };

describe('native provider stream contracts', () => {
  it('accumulates DeepSeek fragments exactly once and preserves reasoning', async () => {
    mock.connect.mockImplementation(async (_config, cb) => {
      cb.onData(delta({ reasoning_content: 'reasoning' }));
      cb.onData(delta({ tool_calls: [{ index: 0, id: 'a', function: { name: 'fs__write', arguments: '{"path":' } }] }));
      cb.onData(delta({ tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] }, 'tool_calls'));
      cb.onData('[DONE]');
    });
    const provider = new DeepSeekProvider('https://example.test', 'fixture');
    vi.spyOn(provider as any, 'getApiKey').mockResolvedValue('fixture');
    const onEvent = vi.fn();
    await provider.chatStream('test', [], { onEvent });
    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent.mock.calls[0][0]).toMatchObject({
      type: 'tool_call', providerData: { reasoning_content: 'reasoning' },
      toolCall: 'a', parsed: { serverName: 'fs', toolName: 'write', arguments: '{"path":"a"}' },
    });
  });

  it.each(['text/event-stream', 'application/x-ndjson'])('rejects unfinished native calls on EOF (%s)', async (contentType) => {
    const prefix = contentType === 'text/event-stream' ? 'data: ' : '';
    mock.fetch.mockResolvedValue(new Response(prefix + delta(call) + '\n\n', { headers: { 'content-type': contentType } }));
    const provider = new OpenAICompatibleProvider('https://example.test', 'fixture');
    vi.spyOn(provider as any, 'getApiKey').mockResolvedValue('fixture');
    const onEvent = vi.fn(), onError = vi.fn(), onComplete = vi.fn();
    await provider.chatStream('test', [], { onEvent, onError, onComplete });
    expect(onEvent).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it.each(['tool_calls', 'length'])('handles completion reason %s without double-emitting at DONE/EOF', async (reason) => {
    mock.fetch.mockResolvedValue(new Response(`data: ${delta(call)}\n\ndata: ${delta({}, reason)}\n\ndata: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    }));
    const provider = new OpenAICompatibleProvider('https://example.test', 'fixture');
    vi.spyOn(provider as any, 'getApiKey').mockResolvedValue('fixture');
    const onEvent = vi.fn(), onError = vi.fn(), onComplete = vi.fn();
    await provider.chatStream('test', [], { onEvent, onError, onComplete });
    expect(onEvent).toHaveBeenCalledTimes(reason === 'tool_calls' ? 1 : 0);
    expect(onComplete).toHaveBeenCalledTimes(reason === 'tool_calls' ? 1 : 0);
    expect(onError).toHaveBeenCalledTimes(reason === 'length' ? 1 : 0);
  });

  it('reports the HTTP error body instead of re-sending the request on another transport', async () => {
    // Regression: a non-OK response used to trigger a full second request over
    // the SSE fallback.  The retry hid the server's own explanation behind a
    // transport error and generated the same completion twice.
    const body = '{"error":{"message":"message 5 has role \'system\' after a non-system turn"}}';
    mock.fetch.mockResolvedValue(new Response(body, {
      status: 400, statusText: 'Bad Request', headers: { 'content-type': 'application/json' },
    }));
    const provider = new OpenAICompatibleProvider('https://example.test', 'fixture');
    vi.spyOn(provider as any, 'getApiKey').mockResolvedValue('fixture');
    const onError = vi.fn(), onComplete = vi.fn();

    await provider.chatStream('test', [], { onError, onComplete } as any);

    expect(mock.fetch).toHaveBeenCalledTimes(1);
    expect(mock.connect).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0].message)).toContain("has role 'system' after a non-system turn");
    expect((onError.mock.calls[0][0] as any).code).toBe('PROVIDER_HTTP_ERROR');
  });

  it('keeps the first error when the fallback transport closes afterwards', async () => {
    // Regression: the transport close produced a second, vaguer error that
    // replaced the server's real message in the UI.
    mock.fetch.mockRejectedValue(new Error('no tauri transport'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no browser transport')));
    mock.connect.mockImplementation(async (_config, cb) => {
      cb.onError(new Error('HTTP 400 Bad Request: {"error":{"message":"context length exceeded"}}'));
      cb.onClose();
    });
    const provider = new OpenAICompatibleProvider('https://example.test', 'fixture');
    vi.spyOn(provider as any, 'getApiKey').mockResolvedValue('fixture');
    const onError = vi.fn(), onComplete = vi.fn();

    await provider.chatStream('test', [], { onError, onComplete } as any);

    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0].message)).toContain('context length exceeded');
  });
});
