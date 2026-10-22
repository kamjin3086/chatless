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
import { GoogleAIProvider } from '../GoogleAIProvider';
import { OllamaProvider } from '../OllamaProvider';
import { OpenAICompatibleProvider } from '../OpenAICompatibleProvider';
import { OpenAIProvider } from '../OpenAIProvider';
import { OpenAIResponsesProvider } from '../OpenAIResponsesProvider';
import { buildAnthropicRequestOptions } from '../AnthropicProvider';
import { buildGeminiGenerationConfig } from '../GoogleAIProvider';
import { ModelParametersService } from '@/lib/model-parameters';
import { DEFAULT_MODEL_PARAMETERS } from '@/types/model-params';
import { PROVIDER_CONFIGS } from '@/lib/llm/provider-field-support';

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
  {
    // Google builds its body explicitly rather than spreading the bag, but its
    // `generationConfig` has its own camelCase wire names (`topP`, `maxOutputTokens`), which
    // is exactly the shape a reader could mistake for a leftover app-side name.
    name: 'Google AI',
    make: () => new GoogleAIProvider('https://example.test/v1beta', 'fixture'),
    maxTokensField: 'maxOutputTokens',
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

describe.each(cases)('$name request body', ({ name, make, maxTokensField }) => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.tauriFetch.mockResolvedValue(rejected());
    mocks.browserFetch.mockResolvedValue(rejected());
    vi.stubGlobal('fetch', mocks.browserFetch);
  });

  it('carries no key that only this app owns', async () => {
    // Key-level, not substring: a JSON string cannot tell a leaked key from a value that
    // happens to spell the same word.
    // Gemini's `generationConfig` spells the same three parameters in camelCase. Those are
    // its wire names, not leftovers, so they are allowed there and nowhere else - outside
    // that object a `topP`/`maxOutputTokens` would be an app-side name on the wire.
    const geminiWire =
      name === 'Google AI'
        ? new Set(['topP', 'maxOutputTokens', 'stopSequences'])
        : new Set<string>();

    for (const { key, path } of keysIn(await bodyFor(make))) {
      expect(key.startsWith('__'), `${path} reached the wire`).toBe(false);
      if (path.startsWith('body.generationConfig.') && geminiWire.has(key))
        continue;
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

/**
 * The other half of #151: a field this provider's protocol does not have must not be
 * renamed into it. `top_k`/`min_p` are Ollama/Google words, not OpenAI ones, and the
 * generic `thinking` boolean / `format` string are app-side names. A clean OpenAI bag
 * carries none of them, even when a stale bag or an advanced-JSON row still holds them.
 */
describe('parameters a provider does not have are not invented', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.tauriFetch.mockResolvedValue(rejected());
    mocks.browserFetch.mockResolvedValue(rejected());
    vi.stubGlobal('fetch', mocks.browserFetch);
  });

  const invented = {
    ...appOptions,
    topK: 40,
    minP: 0.05,
    thinking: true,
    format: 'json',
  };

  it.each(['OpenAI-compatible', 'OpenAI', 'DeepSeek', 'OpenAI Responses'])(
    '%s drops top_k/min_p/thinking/format',
    async (name) => {
      const testCase = cases.find((c) => c.name === name)!;
      const body = await bodyFor(testCase.make, invented);
      const wire = JSON.stringify(body);
      for (const key of ['top_k', 'min_p', 'thinking', 'format']) {
        expect(wire, `${name} sent ${key}`).not.toContain(`"${key}"`);
      }
    },
  );

  it('Ollama maps the fields it does have and keeps them out of the wrong shape', async () => {
    const body = await bodyFor(
      () => new OllamaProvider('http://localhost:11434'),
      invented,
    );
    expect(body.options.top_k).toBe(40);
    expect(body.options.min_p).toBe(0.05);
    expect(body.options).not.toHaveProperty('thinking');
    expect(body.options).not.toHaveProperty('format');
    expect(body.think).toBe(true);
    expect(body.format).toBe('json');
  });

  it('OpenAI Responses keeps its own token field and drops chat-only fields', async () => {
    const body = await bodyFor(
      () => new OpenAIResponsesProvider('https://example.test/v1'),
      {
        ...appOptions,
        maxOutputTokens: 300,
        // Both are aliases for the same wire field; the row's canonical `maxTokens`
        // wins over `maxOutputTokens`, which is the one documented precedence rule.
        maxTokens: 999,
        stop: ['END'],
        frequencyPenalty: 0.1,
        presencePenalty: 0.2,
        topK: 40,
        minP: 0.05,
        thinking: true,
        format: 'json',
      },
    );
    expect(body.max_output_tokens).toBe(999);
    for (const key of [
      'max_tokens',
      'stop',
      'frequency_penalty',
      'presence_penalty',
      'top_k',
      'min_p',
      'thinking',
      'format',
    ]) {
      expect(body, `Responses sent ${key}`).not.toHaveProperty(key);
    }
  });

  it('the generic format never reaches the frozen Anthropic adapter', async () => {
    const body = await bodyFor(
      () => new AnthropicProvider('https://example.test/v1'),
      { ...appOptions, format: 'json' },
    );
    expect(body).not.toHaveProperty('format');
  });

  it.each(['OpenAI-compatible', 'OpenAI', 'DeepSeek'])(
    '%s carries the supported stop sequences and penalties',
    async (name) => {
      const testCase = cases.find((c) => c.name === name)!;
      const body = await bodyFor(testCase.make, {
        ...appOptions,
        frequencyPenalty: 0.1,
        presencePenalty: 0.2,
        stop: ['END'],
      });
      expect(body.frequency_penalty).toBe(0.1);
      expect(body.presence_penalty).toBe(0.2);
      expect(body.stop).toEqual(['END']);
    },
  );

  it('Ollama carries stop sequences under its options object', async () => {
    const body = await bodyFor(
      () => new OllamaProvider('http://localhost:11434'),
      { ...appOptions, stop: ['END'] },
    );
    expect(body.options.stop).toEqual(['END']);
  });

  it('maps Ollama penalties that used to be skipped without a mapping', async () => {
    const body = await bodyFor(
      () => new OllamaProvider('http://localhost:11434'),
      { ...appOptions, frequencyPenalty: 0.1, presencePenalty: 0.2 },
    );
    expect(body.options.frequency_penalty).toBe(0.1);
    expect(body.options.presence_penalty).toBe(0.2);
  });
});

/**
 * A default bag is the strongest form of "nothing was chosen": the body must carry no
 * sampling parameter at all. Anthropic is the documented exception - its protocol
 * requires max_tokens, so the adapter supplies one.
 */
describe('a default bag sends no sampling parameter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.tauriFetch.mockResolvedValue(rejected());
    mocks.browserFetch.mockResolvedValue(rejected());
    vi.stubGlobal('fetch', mocks.browserFetch);
  });

  const samplingKeys = [
    'temperature',
    'max_tokens',
    'max_output_tokens',
    'top_p',
    'top_k',
    'min_p',
    'frequency_penalty',
    'presence_penalty',
    'stop',
    'stop_sequences',
    'thinking',
    'format',
  ];

  it.each(cases.filter((c) => c.name !== 'Anthropic'))(
    '$name sends none of them',
    async ({ make, name }) => {
      const options = ModelParametersService.convertToChatOptions(
        DEFAULT_MODEL_PARAMETERS,
      );
      const body = await bodyFor(make, options);
      const found = keysIn(body)
        .map(({ key }) => key)
        .filter((key) => samplingKeys.includes(key));
      expect(found, `${name}: ${JSON.stringify(body)}`).toEqual([]);
      if (name === 'Ollama') {
        expect(body.options).toEqual({});
      }
    },
  );
});

/**
 * #178: the table is the single answer only if a rename in a row and the wire cannot
 * disagree. Every provider with a row is built here with every generic field set, then
 * asserted field by field against the row: supported fields arrive under the row's wire
 * name at the provider's documented shape, unsupported fields do not arrive at all.
 *
 * A hardcoded provider rename fails the first half (the row says `max`, the body says
 * `max_tokens`); a hardcoded unsupported field fails the second half (the row dropped it,
 * the body still carries it). OpenAICompatibleProvider has no row of its own and is covered
 * through the default/openai row; MultiStrategyProvider is a facade and must stay out of
 * this table entirely.
 */
type WireShape = 'flat' | 'options' | 'generationConfig';

const driftValues = {
  temperature: 0.31,
  maxTokens: 321,
  topP: 0.41,
  topK: 41,
  minP: 0.051,
  frequencyPenalty: 0.11,
  presencePenalty: 0.21,
  stop: ['DRIFT_STOP'],
  thinking: true,
  format: 'json',
} as const;

const driftCases: Array<{
  /** The case name in `cases` above. */
  caseName: string;
  /** The PROVIDER_CONFIGS row this provider reads. */
  row: string;
  shape: WireShape;
}> = [
  { caseName: 'OpenAI', row: 'openai', shape: 'flat' },
  { caseName: 'OpenAI-compatible', row: 'openai', shape: 'flat' },
  { caseName: 'DeepSeek', row: 'deepseek', shape: 'flat' },
  { caseName: 'OpenAI Responses', row: 'openai-responses', shape: 'flat' },
  { caseName: 'Anthropic', row: 'anthropic', shape: 'flat' },
  { caseName: 'Ollama', row: 'ollama', shape: 'options' },
  { caseName: 'Google AI', row: 'google-ai', shape: 'generationConfig' },
];

/** Every spelling a generic field has taken in any provider protocol. */
const knownWireNames: Record<string, string[]> = {
  temperature: ['temperature'],
  maxTokens: [
    'max_tokens',
    'max_output_tokens',
    'maxOutputTokens',
    'num_predict',
  ],
  topP: ['top_p', 'topP'],
  topK: ['top_k', 'topK'],
  minP: ['min_p', 'minP'],
  frequencyPenalty: ['frequency_penalty'],
  presencePenalty: ['presence_penalty'],
  stop: ['stop', 'stop_sequences', 'stopSequences'],
  thinking: ['thinking', 'think'],
  format: ['format'],
};

function wireValue(
  body: Record<string, any>,
  shape: WireShape,
  field: string,
  wireName: string,
): unknown {
  if (shape === 'flat') return body[wireName];
  if (shape === 'generationConfig') return body.generationConfig?.[wireName];
  // Ollama: most parameters live under `options`; format is a top-level body field,
  // which is exactly the shape the table cannot express.
  if (field === 'format') return body.format;
  return body.options?.[wireName];
}

describe.each(driftCases)(
  'the table and the wire agree for $caseName',
  ({ caseName, row, shape }) => {
    const testCase = cases.find((candidate) => candidate.name === caseName);
    if (!testCase) throw new Error(`no request builder named ${caseName}`);
    const config = PROVIDER_CONFIGS[row];
    if (!config) throw new Error(`no PROVIDER_CONFIGS row named ${row}`);

    beforeEach(() => {
      vi.resetAllMocks();
      mocks.tauriFetch.mockResolvedValue(rejected());
      mocks.browserFetch.mockResolvedValue(rejected());
      vi.stubGlobal('fetch', mocks.browserFetch);
    });

    it('sends every supported field under the row spelling, and no unsupported one', async () => {
      const options = { ...appOptions, ...driftValues };
      // Anthropic and Gemini expose their body builders; use them directly instead of
      // going through chatStream's transport seam.
      const body =
        caseName === 'Anthropic'
          ? buildAnthropicRequestOptions(options)
          : caseName === 'Google AI'
            ? { generationConfig: buildGeminiGenerationConfig(options) }
            : await bodyFor(testCase.make, options);
      const allKeys = keysIn(body).map(({ key }) => key);

      for (const [field, wireName] of Object.entries(config.fields)) {
        if (wireName === null) {
          // Fields the row accepts but a flat key cannot spell keep their shape in the
          // provider. These are the two documented ones today; a new one must be named
          // here instead of silently skipped.
          if (row === 'ollama' && field === 'thinking') {
            expect(body.think).toBe(driftValues.thinking);
            continue;
          }
          // `stream` is transport: providers set it themselves and `wireOptions` keeps
          // `streaming` app-side. It is deliberately not a table row.
          throw new Error(
            `${row}.${field} is supported but has no asserted wire shape`,
          );
        }

        expect(
          wireValue(body, shape, field, wireName),
          `${caseName}.${field} should arrive as ${wireName}`,
        ).toEqual(driftValues[field as keyof typeof driftValues]);
      }

      const supported = new Set(Object.keys(config.fields));
      for (const field of Object.keys(driftValues)) {
        if (supported.has(field)) continue;
        for (const wireName of knownWireNames[field] ?? [field]) {
          expect(
            allKeys,
            `${caseName} sent unsupported ${field} as ${wireName}`,
          ).not.toContain(wireName);
        }
      }

      // The sets, not just presence: an extra `max_tokens` left behind by a renamed row
      // is exactly the rename/fallback disagreement this test exists to catch.
      const expectedWire = new Set(
        Object.values(config.fields).filter(
          (wire): wire is string => wire !== null,
        ),
      );
      if (row === 'ollama') expectedWire.add('think'); // the documented null shape
      const known = new Set(Object.values(knownWireNames).flat());
      const actualWire = [
        ...new Set(allKeys.filter((key) => known.has(key))),
      ].sort();
      expect(actualWire).toEqual([...expectedWire].sort());
    });
  },
);

describe('a native wire field wins over the generic option', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.tauriFetch.mockResolvedValue(rejected());
    mocks.browserFetch.mockResolvedValue(rejected());
    vi.stubGlobal('fetch', mocks.browserFetch);
  });

  it.each(['OpenAI', 'OpenAI-compatible', 'DeepSeek', 'Anthropic'])(
    '%s keeps an advanced native max_tokens over maxTokens',
    async (name) => {
      const testCase = cases.find((candidate) => candidate.name === name)!;
      const body = await bodyFor(testCase.make, {
        ...appOptions,
        maxTokens: 999,
        max_tokens: 500,
      });
      expect(body.max_tokens).toBe(500);
    },
  );

  it('OpenAI Responses keeps an advanced native max_output_tokens', async () => {
    const body = await bodyFor(
      () => new OpenAIResponsesProvider('https://example.test/v1'),
      { ...appOptions, maxTokens: 999, max_output_tokens: 500 },
    );
    expect(body.max_output_tokens).toBe(500);
    expect(body).not.toHaveProperty('max_tokens');
  });
});

describe('the drift test covers the table, not just the builders', () => {
  it('has a case for every row and every request builder', () => {
    const coveredRows = [...new Set(driftCases.map(({ row }) => row))].sort();
    expect(coveredRows).toEqual(Object.keys(PROVIDER_CONFIGS).sort());

    const builders = cases.map(({ name }) => name).sort();
    const coveredBuilders = driftCases.map(({ caseName }) => caseName).sort();
    expect(coveredBuilders).toEqual(builders);

    // OpenAICompatibleProvider has no row of its own; it is covered against the
    // documented default (the openai row). MultiStrategyProvider is a facade with no
    // request-body builder and no row, by design. Neither is silently skipped.
    expect(
      driftCases.find(({ caseName }) => caseName === 'OpenAI-compatible')?.row,
    ).toBe('openai');
  });
});
