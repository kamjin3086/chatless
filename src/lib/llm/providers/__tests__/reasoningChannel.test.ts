import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StandardThinkingStrategy } from '../thinking/standard-thinking-strategy';
import { OpenAICompatibleProvider } from '../OpenAICompatibleProvider';

/**
 * Regression: an OpenAI-compatible endpoint streams reasoning on its own
 * `reasoning_content` channel.  The provider used to wrap every reasoning delta
 * in `<think>...</think>`, which produced one closed think block per token, so
 * the text was emitted once as thinking and once as body and the tags leaked
 * into the visible answer (doubled words such as "user user just just").
 */

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/request', () => ({ tauriFetch: mocks.fetch }));

const delta = (value: unknown, finish_reason: string | null = null) =>
  JSON.stringify({ choices: [{ delta: value, finish_reason }] });

describe('standard strategy reasoning channel', () => {
  it('emits one thinking block for a reasoning_content stream and no tags in the answer', () => {
    const strategy = new StandardThinkingStrategy();
    strategy.reset();
    const events = [
      ...strategy.processToken({ reasoning_content: 'The' }).events,
      ...strategy.processToken({ reasoning_content: ' user' }).events,
      ...strategy.processToken({ reasoning_content: ' wrote' }).events,
      ...strategy.processToken({ content: '你好！' }).events,
      ...strategy.processToken({ done: true }).events,
    ];

    expect(events.map((event) => event.type)).toEqual([
      'thinking_start',
      'thinking_token',
      'thinking_token',
      'thinking_token',
      'thinking_end',
      'content_token',
      'stream_complete',
    ]);
    expect(events.filter((e) => e.type === 'thinking_token').map((e: any) => e.content).join(''))
      .toBe('The user wrote');
    const body = events.filter((e) => e.type === 'content_token').map((e: any) => e.content).join('');
    expect(body).toBe('你好！');
    expect(body).not.toContain('<think>');
  });

  it('still parses tag-based reasoning from content', () => {
    const strategy = new StandardThinkingStrategy();
    strategy.reset();
    const events = [
      ...strategy.processToken({ content: '<think>step ' }).events,
      ...strategy.processToken({ content: 'one</think>answer' }).events,
      ...strategy.processToken({ done: true }).events,
    ];
    const thinking = events.filter((e) => e.type === 'thinking_token').map((e: any) => e.content).join('');
    const body = events.filter((e) => e.type === 'content_token').map((e: any) => e.content).join('');
    expect(thinking).toContain('step');
    expect(body).toContain('answer');
    expect(body).not.toContain('<think>');
  });
});

describe('OpenAI-compatible provider reasoning stream', () => {
  beforeEach(() => vi.resetAllMocks());

  it('keeps reasoning out of the answer text', async () => {
    const body = [
      `data: ${delta({ reasoning_content: 'The' })}`,
      `data: ${delta({ reasoning_content: ' user' })}`,
      `data: ${delta({ content: '你好！有什么可以帮你的吗？' })}`,
      `data: ${delta({}, 'stop')}`,
      'data: [DONE]',
      '',
    ].join('\n\n');
    mocks.fetch.mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));

    const provider = new OpenAICompatibleProvider('https://example.test/v1', undefined, 'fixture');
    vi.spyOn(provider as any, 'getApiKey').mockResolvedValue('fixture');
    const events: any[] = [];
    await provider.chatStream('hi', [{ role: 'user', content: 'hi' }], {
      onEvent: (event) => events.push(event),
    });

    const types = events.map((event) => event.type);
    expect(types.filter((type) => type === 'thinking_start')).toHaveLength(1);
    expect(types.filter((type) => type === 'thinking_end')).toHaveLength(1);
    const thinking = events.filter((e) => e.type === 'thinking_token').map((e) => e.content).join('');
    const answer = events.filter((e) => e.type === 'content_token').map((e) => e.content).join('');
    expect(thinking).toBe('The user');
    expect(answer).toBe('你好！有什么可以帮你的吗？');
    expect(JSON.stringify(events)).not.toContain('<think>');
  });
});
