import { describe, expect, it, vi } from 'vitest';
import {
  MODEL_PROBE_MAX_OUTPUT_TOKENS,
  MODEL_PROBE_PROMPT,
  MODEL_PROBE_TOKEN_BOUND,
  probeModel,
} from '../modelProbe';
import { IncompleteResponseError } from '../providers/incompleteResponse';

/** A clock that advances by the given amount on each read. */
function steppedClock(start: number, step: number) {
  let current = start;
  return () => {
    const value = current;
    current += step;
    return value;
  };
}

describe('probeModel', () => {
  it('asks one tiny question with the probe budget', async () => {
    const chat = vi.fn().mockResolvedValue({ content: 'OK' });

    await probeModel('Aggregator', 'm', { chat, now: steppedClock(0, 100) });

    expect(chat).toHaveBeenCalledOnce();
    expect(chat.mock.calls[0][2]).toEqual([
      { role: 'user', content: MODEL_PROBE_PROMPT },
    ]);
    expect(chat.mock.calls[0][3]).toMatchObject({
      temperature: 0,
      maxTokens: MODEL_PROBE_MAX_OUTPUT_TOKENS,
      stream: true,
    });
  });

  it('counts an answer as reachable and reports its wall time', async () => {
    const verdict = await probeModel('Aggregator', 'm', {
      chat: async () => ({ content: 'OK' }),
      now: steppedClock(1_000, 250),
    });

    expect(verdict).toMatchObject({
      ok: true,
      status: 'answered',
      durationMs: 250,
    });
    expect(verdict.tokenEstimate).toBeGreaterThan(
      MODEL_PROBE_TOKEN_BOUND - MODEL_PROBE_MAX_OUTPUT_TOKENS,
    );
  });

  // #151: build.nvidia.com answered the probe and stopped at the probe's own
  // eight-token cap. That was reported as "模型不可用 Response incomplete: length",
  // which is a verdict about the endpoint taken from a limit the app chose.
  it('counts a completion stopped by its own output cap as reachable', async () => {
    const verdict = await probeModel('Aggregator', 'deepseek-reasoner', {
      chat: async () => {
        throw new IncompleteResponseError('length');
      },
      now: steppedClock(0, 44_273),
    });

    expect(verdict).toMatchObject({
      ok: true,
      status: 'truncated',
      finishReason: 'length',
      durationMs: 44_273,
    });
    expect(verdict.tokenEstimate).toBe(MODEL_PROBE_TOKEN_BOUND);
  });

  it('still calls content filtering a reachable endpoint', async () => {
    const verdict = await probeModel('Aggregator', 'm', {
      chat: async () => {
        throw new IncompleteResponseError('content_filter');
      },
    });

    expect(verdict).toMatchObject({
      ok: true,
      status: 'truncated',
      finishReason: 'content_filter',
    });
  });

  it('calls a completion with no content and no truncation unusable', async () => {
    const verdict = await probeModel('Aggregator', 'm', {
      chat: async () => ({ content: '   ' }),
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.status).toBe('empty');
    expect(verdict.message).toContain('响应内容为空');
  });

  it('keeps the provider explanation when the endpoint refused the request', async () => {
    const error = Object.assign(new Error('HTTP 401 Unauthorized'), {
      userMessage: '未配置 API 密钥',
    });
    const verdict = await probeModel('Aggregator', 'm', {
      chat: async () => {
        throw error;
      },
    });

    expect(verdict).toMatchObject({
      ok: false,
      status: 'failed',
      message: '未配置 API 密钥',
    });
  });

  it('falls back to the transport message, and never to an empty verdict', async () => {
    const withMessage = await probeModel('Aggregator', 'm', {
      chat: async () => {
        throw new Error('fetch failed');
      },
    });
    const withoutMessage = await probeModel('Aggregator', 'm', {
      chat: async () => {
        throw 'boom';
      },
    });

    expect(withMessage.message).toBe('fetch failed');
    expect(withoutMessage.message).toBe('测试失败');
  });
});
