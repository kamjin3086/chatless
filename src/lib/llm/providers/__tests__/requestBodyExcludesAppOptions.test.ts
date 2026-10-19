/**
 * Request bodies for every provider that builds one by spreading the options bag.
 *
 * #151: NVIDIA NIM rejected the body with
 * `Validation: Unsupported parameter(s): __schedulerLease, __requestId, streaming`.
 * The keys that came from this app - the scheduler lease, the request id, the internal
 * `chat()` markers, telemetry ids, and `streaming` (the wire says `stream`) - were being
 * forwarded because each provider copied everything it did not name. These tests assert
 * on the body the transport actually receives, so the next internal key that appears in
 * the bag is caught here instead of on a user's request.
 *
 * The same seam also holds the second half: a parameter this app names (`maxTokens`) must
 * arrive under the provider's wire name only, never as itself - a strict server rejects it
 * as unknown.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '../AnthropicProvider';
import { DeepSeekProvider } from '../DeepSeekProvider';
import { OllamaProvider } from '../OllamaProvider';
import { OpenAICompatibleProvider } from '../OpenAICompatibleProvider';
import { OpenAIProvider } from '../OpenAIProvider';
import { OpenAIResponsesProvider } from '../OpenAIResponsesProvider';

const mocks = vi.hoisted(() => ({
  tauriFetch: vi.fn(),
  browserFetch: vi.fn(),
}));
vi.mock('@/lib/request', () => ({ tauriFetch: mocks.tauriFetch }));
// The providers that speak through SSEClient choose a transport at run time. In the test
// environment neither Tauri nor a provider preference exists, so pin the browser one: it
// takes the same body the Tauri path takes, and `fetch` is observable below.
vi.mock('@/lib/provider/browser-fallback-utils', () => ({
  shouldUseBrowserRequest: async () => true,
}));

/** Everything an ordinary send carries once the scheduler, the agent loop and `chat()`
 * have each added their own keys. */
const appOptions = {
  temperature: 0.4,
  maxTokens: 300,
  topP: 0.9,
  streaming: true,
  conversationId: 'conversation-1',
  messageId: 'message-1',
  contextWindowTokens: 8192,
  __schedulerLease: true,
  __requestId: 'request-1',
  __internal: true,
  __silentMode: true,
};

/**
 * Names this app owns outright: no provider's protocol has ever taken one as a field.
 * `tools`, `stop` and `options` are deliberately absent - they are real wire fields for the
 * OpenAI family and for Ollama, and a provider writes those itself from the original bag.
 * What must not travel is the app's copy of the names below.
 */
const neverWireKeys = [
  'streaming',
  'conversationId',
  'messageId',
  'contextWindowTokens',
  'thinkingLevel',
  'thinkingModelSuffixes',
  'maxTokens',
  'maxOutputTokens',
  'topP',
  'topK',
  'minP',
  'frequencyPenalty',
  'presencePenalty',
  'numPredict',
  'numCtx',
  'repeatLastN',
  'repeatPenalty',
  'toolChoice',
  'parallelToolCalls',
  'extensions',
  'mcpServers',
];

/** Every key in the body at any depth - Ollama nests its parameters under `options`. */
function keysIn(
  value: unknown,
  path = 'body',
): Array<{ key: string; path: string }> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => keysIn(item, `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, inner]) => [
      { key, path: `${path}.${key}` },
      ...keysIn(inner, `${path}.${key}`),
    ],
  );
}

function rejected(): Response {
  return new Response(
    JSON.stringify({ message: 'Validation: Unsupported parameter(s)' }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  );
}

type Case = {
  name: string;
  make: () => any;
  /** Where this provider expects the 300-token ceiling. */
  maxTokensField: string;
};

const cases: Case[] = [
  {
    name: 'OpenAI-compatible',
    make: () =>
      new OpenAICompatibleProvider(
        'https://example.test/v1',
        undefined,
        'NVIDIA',
      ),
    maxTokensField: 'max_tokens',
  },
  {
    name: 'OpenAI',
    make: () => new OpenAIProvider('https://example.test/v1'),
    maxTokensField: 'max_tokens',
  },
  {
    name: 'DeepSeek',
    make: () => new DeepSeekProvider('https://example.test/v1'),
    maxTokensField: 'max_tokens',
  },
  {
    name: 'OpenAI Responses',
    make: () => new OpenAIResponsesProvider('https://example.test/v1'),
    maxTokensField: 'max_output_tokens',
  },
  {
    name: 'Anthropic',
    make: () => new AnthropicProvider('https://example.test/v1'),
    maxTokensField: 'max_tokens',
  },
  {
    name: 'Ollama',
    make: () => new OllamaProvider('http://localhost:11434'),
    maxTokensField: 'num_predict',
  },
];

/** The body the provider handed to its transport, whichever transport it used. */
async function bodyFor(
  make: () => any,
  options: Record<string, unknown> = appOptions,
) {
  const provider = make();
  vi.spyOn(provider, 'getApiKey').mockResolvedValue('fixture');
  await provider
    .chatStream(
      'fixture-model',
      [{ role: 'user', content: 'hi' }],
      { onEvent: () => {}, onError: () => {} },
      options,
    )
    .catch(() => {});

  const call =
    mocks.tauriFetch.mock.calls[0] ?? mocks.browserFetch.mock.calls[0];
  if (!call) throw new Error('the provider sent no request');
  const sent = call[1].body;
  return typeof sent === 'string' ? JSON.parse(sent) : sent;
}

describe.each(cases)('$name request body', ({ make, maxTokensField }) => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.tauriFetch.mockResolvedValue(rejected());
    mocks.browserFetch.mockResolvedValue(rejected());
    vi.stubGlobal('fetch', mocks.browserFetch);
  });

  it('carries no key that only this app owns', async () => {
    // Key-level, not substring: a JSON string cannot tell a leaked key from a value that
    // happens to spell the same word.
    for (const { key, path } of keysIn(await bodyFor(make))) {
      expect(key.startsWith('__'), `${path} reached the wire`).toBe(false);
      expect(neverWireKeys, `${path} reached the wire`).not.toContain(key);
    }
  });

  it('carries the parameters the user chose, under the wire names', async () => {
    const body = await bodyFor(make);
    const wire = JSON.stringify(body);
    expect(wire).toContain('0.4');
    expect(wire).toContain(`"${maxTokensField}":300`);
  });
});

describe('a tool definition still arrives in the provider’s own shape', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.tauriFetch.mockResolvedValue(rejected());
    vi.stubGlobal('fetch', mocks.browserFetch);
  });

  it('OpenAI-compatible converts it instead of forwarding the app shape', async () => {
    const body = await bodyFor(
      () => new OpenAICompatibleProvider('https://example.test/v1'),
      {
        ...appOptions,
        tools: [
          {
            name: 'read_file',
            description: 'Read a file',
            parameters: { type: 'object', properties: {} },
          },
        ],
        toolChoice: 'auto',
      },
    );

    expect(body.tools?.[0]?.type).toBe('function');
    expect(body.tools?.[0]?.function?.name).toBe('read_file');
    expect(body.tool_choice).toBe('auto');
  });
});
