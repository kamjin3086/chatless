import { afterEach, expect, it, vi } from 'vitest';
import { ProviderRegistry } from '@/lib/llm/ProviderRegistry';
import { LLMInterpreter } from '@/lib/llm/interpreter';
import { AnthropicProvider } from '@/lib/llm/providers/AnthropicProvider';
import { OpenAIResponsesProvider } from '@/lib/llm/providers/OpenAIResponsesProvider';
import { acquireAndroidPhoto } from '@/lib/android/androidPhoto';
import { GoogleAIProvider } from '@/lib/llm/providers/GoogleAIProvider';
import { OllamaProvider } from '@/lib/llm/providers/OllamaProvider';
import { OpenAICompatibleProvider } from '@/lib/llm/providers/OpenAICompatibleProvider';
import { OpenAIProvider } from '@/lib/llm/providers/OpenAIProvider';
import {
  guardAndroidPhotoSend,
  resolveAndroidPhotoRoute,
  sendAndroidPhoto,
  shouldClearPhotoDraft,
  trackAndroidPhotoResponse,
} from '@/lib/android/androidPhotoSend';

const { transport, modelStrategy } = vi.hoisted(() => ({
  transport: vi.fn(),
  modelStrategy: vi.fn(async (): Promise<string | null> => null),
}));
vi.mock('@/lib/request', () => ({ tauriFetch: transport }));
vi.mock('@/lib/llm/KeyManager', () => ({
  KeyManager: {
    getProviderKey: async () => 'fake',
    getModelKey: async () => null,
  },
}));
vi.mock('@/lib/storage', () => ({
  StorageUtil: { getItem: async () => [] },
  specializedStorage: {
    models: {
      getModelStrategy: modelStrategy,
      getProviderDefaultStrategy: async () => null,
    },
  },
}));
vi.mock('@/lib/provider/browser-fallback-utils', () => ({
  shouldUseBrowserRequest: async () => true,
}));

afterEach(() => {
  ProviderRegistry.clear();
  vi.unstubAllGlobals();
  transport.mockReset();
  modelStrategy.mockReset();
});

it.each([
  {
    provider: new OpenAICompatibleProvider('https://example.test/v1'),
    modelId: 'gpt-4o',
    encoding: 'data-url',
    route: 'openai-compatible',
    body: {
      messages: [
        {
          content: [
            {
              type: 'image_url',
              image_url: { url: 'data:image/jpeg;base64,YWJj' },
            },
          ],
        },
      ],
    },
  },
  {
    provider: new GoogleAIProvider('https://example.test', 'fake'),
    modelId: 'gemini-2.5-flash',
    encoding: 'data-url',
    route: 'gemini',
    body: {
      contents: [
        {
          parts: [
            { text: 'What is this?' },
            { inlineData: { mimeType: 'image/jpeg', data: 'YWJj' } },
          ],
        },
      ],
    },
  },
  {
    provider: new OllamaProvider('http://localhost:11434'),
    modelId: 'llava',
    encoding: 'base64',
    route: 'ollama',
    body: {
      messages: [{ content: 'What is this?', images: ['YWJj'] }],
    },
  },
] as const)(
  'sends the preview to $provider.name only when explicitly submitted',
  async ({ provider, modelId, encoding, route, body }) => {
    ProviderRegistry.register(provider);
    expect(await resolveAndroidPhotoRoute(provider.name, modelId)).toBe(route);
    // The real provider adapter builds the request from the shared-send payload.
    transport.mockImplementation(
      async () => new Response('{}', { status: 400 }),
    );
    vi.stubGlobal('fetch', transport);
    const selected = await acquireAndroidPhoto('pick', async () => ({
      status: 'selected',
      jpegBase64: 'YWJj',
    }));
    expect(selected).toMatchObject({
      status: 'selected',
      photo: { dataUrl: 'data:image/jpeg;base64,YWJj' },
    });
    if (selected.status !== 'selected') throw new Error('Expected photo');
    const send = vi.fn(async (content, { images }) => {
      await new LLMInterpreter()
        .streamChat(
          provider.name,
          modelId,
          [{ role: 'user', content, images }],
          {},
          {
            __androidPhotoRecipient: {
              providerName: provider.name,
              modelId,
              route,
            },
          },
        )
        .catch(() => {});
    });
    expect(transport).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();

    await sendAndroidPhoto(
      selected.photo,
      'What is this?',
      { providerName: provider.name, modelId, route },
      send,
    );

    expect(send).toHaveBeenCalledExactlyOnceWith('What is this?', {
      images: [encoding === 'base64' ? 'YWJj' : 'data:image/jpeg;base64,YWJj'],
      expectedAndroidPhotoRecipient: {
        providerName: provider.name,
        modelId,
        route,
      },
    });
    const requestBody = transport.mock.calls[0]?.[1].body;
    const wire =
      typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;
    if (body.contents) {
      expect(wire.contents).toEqual([{ role: 'user', ...body.contents[0] }]);
    } else if (encoding === 'base64') {
      expect(wire.messages).toEqual([{ role: 'user', ...body.messages[0] }]);
    } else {
      expect(wire.messages).toEqual([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            ...body.messages[0].content,
          ],
        },
      ]);
    }
  },
);

it.each([
  {
    provider: new OpenAIResponsesProvider('https://example.test/v1'),
    modelId: 'gpt-4o',
  },
  {
    provider: new AnthropicProvider('https://example.test/v1'),
    modelId: 'claude-sonnet-4-5',
  },
  {
    provider: new OpenAIProvider('https://example.test/v1'),
    modelId: 'gpt-4o',
  },
  {
    provider: new OpenAICompatibleProvider('https://example.test/v1'),
    modelId: 'gpt-3.5-turbo',
  },
])(
  'does not submit text-only on $provider.name / $modelId',
  async ({ provider, modelId }) => {
    ProviderRegistry.register(provider);
    const route = await resolveAndroidPhotoRoute(provider.name, modelId);
    const send = vi.fn();
    const photo = { dataUrl: 'data:image/jpeg;base64,YWJj' };
    const recipient = route && {
      providerName: provider.name,
      modelId,
      route,
    };

    await expect(
      sendAndroidPhoto(photo, 'What is this?', recipient, send),
    ).resolves.toBe('unsupported');
    expect(send).not.toHaveBeenCalled();
  },
);

it.each([
  {
    status: 400,
    stream: '{"error":{"message":"context limit"}}',
    accepted: false,
  },
  { status: 200, stream: ': keepalive\n\ndata: [DONE]\n\n', accepted: false },
  {
    status: 200,
    stream: 'data: {"error":{"message":"image rejected"}}\n\ndata: [DONE]\n\n',
    accepted: false,
  },
  {
    status: 200,
    stream:
      'data: {"choices":[{"delta":{"content":"A book"}}]}\n\ndata: [DONE]\n\n',
    accepted: true,
  },
])(
  'acknowledges only a substantive response (HTTP $status, accepted=$accepted)',
  async ({ status, stream, accepted }) => {
    transport.mockResolvedValueOnce(
      new Response(stream, {
        status,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', transport);
    const provider = new OpenAICompatibleProvider('https://example.test/v1');
    const acknowledgement = vi.fn();
    const response = trackAndroidPhotoResponse(acknowledgement);
    const onError = vi.fn();
    await sendAndroidPhoto(
      { dataUrl: 'data:image/jpeg;base64,YWJj' },
      'What is this?',
      {
        providerName: provider.name,
        modelId: 'gpt-4o',
        route: 'openai-compatible',
      },
      (content, { images }) =>
        provider
          .chatStream('gpt-4o', [{ role: 'user', content, images }], {
            onStart: () => {
              expect(acknowledgement).not.toHaveBeenCalled();
            },
            onEvent: response.event,
            onError,
          })
          .catch(() => {}),
    );
    expect(response.accepted).toBe(accepted);
    expect(acknowledgement).toHaveBeenCalledTimes(accepted ? 1 : 0);
    if (status === 400) expect(onError).toHaveBeenCalled();
  },
);

it('acknowledges successful finalization once, not cancellation or error', () => {
  const acknowledge = vi.fn();
  const response = trackAndroidPhotoResponse(acknowledge);

  response.complete('aborted');
  response.complete('error');
  response.complete(undefined);
  expect(acknowledge).not.toHaveBeenCalled();

  response.complete('sent');
  response.complete('sent');
  expect(acknowledge).toHaveBeenCalledTimes(1);
});

it.each(['gemini', 'openai', 'openai-responses', 'anthropic'])(
  'blocks a route changed to %s after composer validation, without contacting it',
  async (strategy) => {
    const provider = new OpenAICompatibleProvider('https://example.test/v1');
    ProviderRegistry.register(provider);
    expect(await resolveAndroidPhotoRoute(provider.name, 'gpt-4o')).toBe(
      'openai-compatible',
    );
    modelStrategy.mockResolvedValue(strategy);
    transport.mockImplementation(
      async () => new Response('{}', { status: 400 }),
    );
    vi.stubGlobal('fetch', transport);

    await expect(
      new LLMInterpreter().streamChat(
        provider.name,
        'gpt-4o',
        [
          {
            role: 'user',
            content: 'What is this?',
            images: ['data:image/jpeg;base64,YWJj'],
          },
        ],
        {},
        {
          __androidPhotoRecipient: {
            providerName: provider.name,
            modelId: 'gpt-4o',
            route: 'openai-compatible',
          },
        },
      ),
    ).rejects.toThrow('recipient_changed');
    expect(transport).not.toHaveBeenCalled();
  },
);

it('rejects a provider mismatch even when the model IDs match', async () => {
  const validateRoute = vi.fn().mockResolvedValue('openai-compatible');
  await expect(
    guardAndroidPhotoSend(
      { providerName: 'A', modelId: 'gpt-4o', route: 'openai-compatible' },
      'B',
      'gpt-4o',
      validateRoute,
      () => false,
    ),
  ).rejects.toMatchObject({ reason: 'recipient_changed' });
  expect(validateRoute).not.toHaveBeenCalled();
});

it('does not clear a photo draft for an unrelated stream or unmatched acknowledgement', () => {
  const photo = { dataUrl: 'data:image/jpeg;base64,YWJj' };
  const submitted = { photo, textRevision: {} };

  expect(shouldClearPhotoDraft(submitted)).toBe(false);
  expect(shouldClearPhotoDraft(submitted, submitted)).toBe(true);
  expect(shouldClearPhotoDraft({ photo, textRevision: {} }, submitted)).toBe(
    false,
  );
  expect(
    shouldClearPhotoDraft({ ...submitted, photo: { ...photo } }, submitted),
  ).toBe(false);
  expect(shouldClearPhotoDraft(null)).toBe(true);
});

it('checks for a newly active run after asynchronous recipient validation', async () => {
  let active = false;
  await expect(
    guardAndroidPhotoSend(
      { providerName: 'A', modelId: 'gpt-4o', route: 'openai-compatible' },
      'A',
      'gpt-4o',
      async () => {
        active = true;
        return 'openai-compatible';
      },
      () => active,
    ),
  ).rejects.toMatchObject({ reason: 'busy' });
});
