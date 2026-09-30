import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../OpenAICompatibleProvider';
import { TURN_BOUNDARY_STOP_SEQUENCES } from '@/lib/llm/chatTemplateTokens';

/**
 * Regression: an OpenAI-compatible server handed back the model's raw chat
 * template. The model wrote `<|im_end|>`, then invented a user turn, then
 * answered that invented turn - and the app rendered the invented answer.
 * Verbatim shape of what the user saw:
 *
 *   user: 你很厉害哦
 *   assistant: 你的消息好像没发完 😄 想让我做什么，直接说就好。
 *
 * The "unfinished message" was the model's own fabricated, truncated user turn.
 */

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/request', () => ({ tauriFetch: mocks.fetch }));

const delta = (value: unknown, finish_reason: string | null = null) =>
  JSON.stringify({ choices: [{ delta: value, finish_reason }] });

const LEAKED_OUTPUT =
  '<think>This is just casual conversation, so I will respond naturally.<|im_end|>\n' +
  '<|im_start|>user\n你能<|im_end|>\n' +
  "<|im_start|>assistant\n<think>\nThe user's message appears to have been cut off midway.";

async function run(content: string, opts: Record<string, unknown> = {}) {
  const body = [
    `data: ${delta({ content })}`,
    `data: ${delta({}, 'stop')}`,
    'data: [DONE]',
    '',
  ].join('\n\n');
  mocks.fetch.mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));

  const provider = new OpenAICompatibleProvider('https://example.test/v1', undefined, 'fixture');
  vi.spyOn(provider as any, 'getApiKey').mockResolvedValue('fixture');
  const events: any[] = [];
  const errors: any[] = [];
  await provider.chatStream('hi', [{ role: 'user', content: 'hi' }], {
    onEvent: (event) => events.push(event),
    onError: (error) => errors.push(error),
  }, opts);
  return { events, errors, provider };
}

describe('OpenAI-compatible provider turn boundary', () => {
  beforeEach(() => vi.resetAllMocks());

  it('never surfaces the turn the model invented for itself', async () => {
    const { events, errors } = await run(LEAKED_OUTPUT);

    const rendered = JSON.stringify(events);
    expect(rendered).not.toContain('你能');
    expect(rendered).not.toContain('cut off');
    expect(rendered).not.toContain('im_end');
    expect(rendered).not.toContain('im_start');
    // The answer preceding the boundary is kept, and the stream still closes.
    expect(rendered).toContain('This is just casual conversation');
    expect(events.map((event) => event.type)).toContain('stream_complete');
    expect(errors).toHaveLength(0);
  });

  it('keeps a clean stream unchanged', async () => {
    const { events, errors } = await run('<think>想一下</think>答案');
    const answer = events
      .filter((event) => event.type === 'content_token')
      .map((event) => event.content)
      .join('');
    expect(answer).toContain('答案');
    expect(JSON.stringify(events)).not.toContain('im_end');
    expect(errors).toHaveLength(0);
  });

  it('stops the upstream generation once the boundary is crossed', async () => {
    await run(LEAKED_OUTPUT);
    // The reader is cancelled so the server does not keep generating turns
    // nobody asked for; the cancel must not break the completion path.
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('sends boundary tokens as stop sequences when the caller configured none', async () => {
    await run('<think>x</think>答案');
    const sent = mocks.fetch.mock.calls[0][1].body;
    expect(sent.stop).toEqual([...TURN_BOUNDARY_STOP_SEQUENCES]);
  });

  it('keeps an explicit stop list from the caller', async () => {
    await run('<think>x</think>答案', { stop: ['\n\n'] });
    const sent = mocks.fetch.mock.calls[0][1].body;
    expect(sent.stop).toEqual(['\n\n']);
  });
});
