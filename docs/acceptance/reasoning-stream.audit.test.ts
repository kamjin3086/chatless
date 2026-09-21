// Live check that a real OpenAI-compatible endpoint's `reasoning_content`
// stream is rendered as one thinking block instead of merged into the answer.
//
// Run: CHATLESS_QWEN=1 pnpm exec vitest run --config docs/acceptance/vitest.config.ts docs/acceptance/reasoning-stream.audit.test.ts
import { describe, expect, it, vi } from 'vitest';

const enabled = process.env.CHATLESS_QWEN === '1';
const endpoint = (process.env.CHATLESS_QWEN_URL || 'http://10.126.126.2:8101').replace(/\/$/, '');
const model = process.env.CHATLESS_QWEN_MODEL || 'Qwen3.8-Flash-Next-medium';

describe.skipIf(!enabled)('live reasoning stream', () => {
  it('keeps reasoning on its own channel and leaves the answer free of think tags', async () => {
    const { OpenAICompatibleProvider } = await import('@/lib/llm/providers/OpenAICompatibleProvider');
    const provider = new OpenAICompatibleProvider(`${endpoint}/v1`, undefined, 'homelab');
    vi.spyOn(provider as any, 'getApiKey').mockResolvedValue('none');

    // The desktop transport is Tauri's SSE client.  Capture the same bytes the
    // endpoint really sends and feed them through the provider's own parser, so
    // this measures the production delta handling and event emission.
    const response = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
        max_tokens: 200,
      }),
    });
    const rawStream = await response.text();
    const reasoningDeltas = (rawStream.match(/reasoning_content/g) || []).length;

    const events: Array<{ type: string; content?: string }> = [];
    let failure: unknown;
    await (provider as any).processSSEResponse(
      new Response(rawStream, { headers: { 'content-type': 'text/event-stream' } }),
      {
        onEvent: (event: any) => events.push(event),
        onError: (error: Error) => { failure = error; },
      } as any,
    );

    const thinking = events.filter((e) => e.type === 'thinking_token').map((e) => e.content || '').join('');
    const answer = events.filter((e) => e.type === 'content_token').map((e) => e.content || '').join('');
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      endpoint, model, failure: failure ? String(failure) : null,
      httpStatus: response.status, rawBytes: rawStream.length, reasoningDeltas,
      types: events.map((e) => e.type).slice(0, 12),
      thinkingStarts: events.filter((e) => e.type === 'thinking_start').length,
      thinkingEnds: events.filter((e) => e.type === 'thinking_end').length,
      thinkingChars: thinking.length,
      answerChars: answer.length,
      thinkingHead: thinking.slice(0, 80),
      answerHead: answer.slice(0, 120),
      leakedTags: /<think>/i.test(answer) || /<\/think>/i.test(answer),
    }, null, 2));

    expect(failure).toBeUndefined();
    expect(response.status).toBe(200);
    expect(reasoningDeltas).toBeGreaterThan(0);
    expect(events.filter((e) => e.type === 'thinking_start')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'thinking_end')).toHaveLength(1);
    expect(thinking.length).toBeGreaterThan(0);
    expect(answer.length).toBeGreaterThan(0);
    expect(answer).not.toMatch(/<\/?think>/i);
  }, 180_000);
});
