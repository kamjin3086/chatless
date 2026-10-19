/**
 * `chat()` is the non-streaming entry point: the settings page's "is this model usable"
 * probe, title generation, RAG answers, context summarisation. It used to answer a failed
 * request with `{ content: '' }`, because the provider's rejection and the terminal
 * callback's error were both swallowed. #151's report is what that looks like from the
 * outside: every NVIDIA model failed with HTTP 400 while the probe said
 * "响应内容为空，可能为不兼容的返回格式" - it could not tell an empty answer from a
 * rejection.
 *
 * A failure is a failure: the caller gets the error. These tests are the seam, because
 * the decision belongs to `chat()`, not to each of its five callers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LLMInterpreter } from '../interpreter';
import { ProviderRegistry } from '../ProviderRegistry';

afterEach(() => ProviderRegistry.clear());

function register(chatStream: (callbacks: any) => Promise<void>) {
  const provider = {
    name: 'fixture',
    chatStream: vi.fn(
      async (_model: string, _messages: unknown[], callbacks: any) =>
        chatStream(callbacks),
    ),
    cancelStream: vi.fn(),
  };
  ProviderRegistry.register(provider as any);
  return new LLMInterpreter();
}

describe('a failed request is not an empty answer', () => {
  it('rejects with the error the provider reported', async () => {
    const interpreter = register(async (callbacks) => {
      callbacks.onError?.(
        new Error(
          'HTTP 400 Bad Request: Unsupported parameter(s): __schedulerLease',
        ),
      );
    });

    await expect(
      interpreter.chat('fixture', 'model', [{ role: 'user', content: 'hi' }]),
    ).rejects.toThrow(/Unsupported parameter/);
  });

  it('rejects when the provider throws instead of reporting', async () => {
    const interpreter = register(async () => {
      throw new Error('NO_KEY');
    });

    await expect(
      interpreter.chat('fixture', 'model', [{ role: 'user', content: 'hi' }]),
    ).rejects.toThrow('NO_KEY');
  });

  it('rejects even when some content arrived before the failure', async () => {
    const interpreter = register(async (callbacks) => {
      callbacks.onEvent?.({ type: 'content_token', content: 'partial' });
      callbacks.onError?.(new Error('HTTP 500 Internal Server Error'));
    });

    await expect(
      interpreter.chat('fixture', 'model', [{ role: 'user', content: 'hi' }]),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('treats a cancelled turn as a failure, like the scheduler already does', async () => {
    // `llm/index.ts` throws '模型请求在排队期间已取消' when a queued request is cancelled, so
    // a `chat()` that resolved empty on an abort would be the odd one out.
    const interpreter = register(async (callbacks) => {
      const aborted = new Error('The operation was aborted');
      aborted.name = 'AbortError';
      callbacks.onError?.(aborted);
    });

    await expect(
      interpreter.chat('fixture', 'model', [{ role: 'user', content: 'hi' }]),
    ).rejects.toThrow(/aborted/);
  });

  it('still answers an ordinary turn', async () => {
    const interpreter = register(async (callbacks) => {
      callbacks.onEvent?.({ type: 'content_token', content: 'OK' });
      callbacks.onComplete?.();
    });

    await expect(
      interpreter.chat('fixture', 'model', [{ role: 'user', content: 'hi' }]),
    ).resolves.toEqual({ content: 'OK', raw: null });
  });
});
