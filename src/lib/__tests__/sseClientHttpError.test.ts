/**
 * #151's second symptom was diagnosed only because the OpenAI-compatible provider keeps the
 * server's own error body: `HTTP 400 Bad Request: {"message":"Validation: Unsupported
 * parameter(s): ..."}`. The providers that speak through SSEClient threw the body away -
 * `fetch` had already thrown on `!response.ok` before anything read it - so a refused
 * request arrived as canned advice whose "原始错误" was a bare `HTTP 400`. A user could not
 * report what the server said, and neither could a test.
 *
 * The body is bounded, because a proxy can answer a 400 with an HTML page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SSEClient } from '@/lib/sse-client';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));

// Outside Tauri with no provider preference the client takes the browser path, which is the
// one that used to discard the body.
vi.mock('@/lib/provider/browser-fallback-utils', () => ({
  shouldUseBrowserRequest: async () => true,
}));

async function errorFor(response: Response): Promise<Error> {
  mocks.fetch.mockResolvedValue(response);
  const errors: Error[] = [];
  const client = new SSEClient('fixture');
  await client
    .startConnection(
      {
        url: 'https://example.test/v1/chat/completions',
        method: 'POST',
        body: { model: 'fixture-model' },
      },
      { onError: (error) => errors.push(error) },
    )
    .catch(() => {});
  if (!errors.length) throw new Error('the client reported no error');
  return errors[0];
}

describe('a rejected SSE request says why', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it("keeps the server's own error body in the message", async () => {
    const error = await errorFor(
      new Response(
        '{"message":"Validation: Unsupported parameter(s): __schedulerLease"}',
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    );

    expect(error.message).toContain('HTTP 400');
    expect(error.message).toContain(
      'Validation: Unsupported parameter(s): __schedulerLease',
    );
  });

  it('does not paste an unbounded body into the message', async () => {
    const error = await errorFor(
      new Response('x'.repeat(50_000), { status: 500 }),
    );

    expect(error.message.length).toBeLessThan(5_000);
  });
});
