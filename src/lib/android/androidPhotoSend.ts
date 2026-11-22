import type { AndroidPhoto } from '@/lib/android/androidPhoto';
import type { BaseProvider } from '@/lib/llm/providers/BaseProvider';
import { GoogleAIProvider } from '@/lib/llm/providers/GoogleAIProvider';
import { OllamaProvider } from '@/lib/llm/providers/OllamaProvider';
import { OpenAICompatibleProvider } from '@/lib/llm/providers/OpenAICompatibleProvider';
import type { StreamEvent } from '@/lib/llm/types/stream-events';

type AndroidPhotoEncoding = 'data-url' | 'base64';
type AndroidPhotoRoute = 'openai-compatible' | 'gemini' | 'ollama';

function androidPhotoEncoding(route: AndroidPhotoRoute): AndroidPhotoEncoding {
  return route === 'ollama' ? 'base64' : 'data-url';
}

export interface AndroidPhotoRecipient {
  providerName: string;
  modelId: string;
  route: AndroidPhotoRoute;
}

export interface AndroidPhotoDraftSnapshot {
  photo: AndroidPhoto;
  textRevision: object;
}

export function shouldClearPhotoDraft(
  current: AndroidPhotoDraftSnapshot | null,
  submitted?: AndroidPhotoDraftSnapshot,
) {
  return current === null
    ? submitted === undefined
    : current.photo === submitted?.photo &&
        current.textRevision === submitted.textRevision;
}

export interface AndroidPhotoSendOptions {
  images: string[];
  expectedAndroidPhotoRecipient: AndroidPhotoRecipient;
}

export interface AndroidPhotoSendCallbacks {
  onAndroidPhotoAccepted?: (conversationId: string) => void;
  onAndroidPhotoConversationCreated?: (conversationId: string) => void;
}

export async function sendAndroidPhoto(
  photo: AndroidPhoto,
  content: string,
  recipient: AndroidPhotoRecipient | null,
  send: (
    content: string,
    options: AndroidPhotoSendOptions,
  ) => void | Promise<void>,
) {
  if (!recipient) return 'unsupported';
  const image =
    androidPhotoEncoding(recipient.route) === 'base64'
      ? photo.dataUrl.split(',')[1]
      : photo.dataUrl;
  await send(content, {
    images: [image],
    expectedAndroidPhotoRecipient: recipient,
  });
  return 'submitted';
}

export function trackAndroidPhotoResponse(onAccepted: () => void) {
  let accepted = false;
  const accept = () => {
    if (accepted) return;
    accepted = true;
    onAccepted();
  };
  return {
    get accepted() {
      return accepted;
    },
    complete(assistantStatus: string | undefined) {
      // Transport EOF alone is not a successful assistant result.
      if (assistantStatus === 'sent') accept();
    },
    event(event: StreamEvent) {
      if (
        ((event.type === 'content_token' || event.type === 'thinking_token') &&
          event.content.trim()) ||
        (event.type === 'tool_call' && event.toolCall.trim())
      ) {
        accept();
      }
    },
  };
}

export class AndroidPhotoSendRejection extends Error {
  constructor(readonly reason: 'recipient_changed' | 'busy' | 'not_accepted') {
    super(reason);
  }
}

// Keep this at the shared send decision, before document/turn writes or any steering.
export async function guardAndroidPhotoSend(
  expected: AndroidPhotoRecipient,
  providerName: string,
  modelId: string,
  resolveRoute: (
    provider: string,
    model: string,
  ) => Promise<AndroidPhotoRoute | null>,
  isRunActive: () => boolean,
) {
  if (expected.providerName !== providerName || expected.modelId !== modelId) {
    throw new AndroidPhotoSendRejection('recipient_changed');
  }
  if ((await resolveRoute(providerName, modelId)) !== expected.route) {
    throw new AndroidPhotoSendRejection('recipient_changed');
  }
  if (isRunActive()) throw new AndroidPhotoSendRejection('busy');
}

function adapterPhotoRoute(adapter: BaseProvider): AndroidPhotoRoute | null {
  if (adapter instanceof OllamaProvider) return 'ollama';
  if (adapter instanceof OpenAICompatibleProvider) return 'openai-compatible';
  if (adapter instanceof GoogleAIProvider) return 'gemini';
  return null;
}

function isUnsupportedPhotoStrategy(strategy: string | null) {
  // Strict OpenAI drops unprefixed SSE chunks. Responses/Anthropic do not carry the image.
  return (
    strategy === 'openai' ||
    strategy === 'openai-responses' ||
    strategy === 'anthropic'
  );
}

export function guardAndroidPhotoWireRoute(
  expected: AndroidPhotoRecipient,
  providerName: string,
  modelId: string,
  adapter: BaseProvider,
  strategy: string | null,
) {
  if (
    providerName !== expected.providerName ||
    modelId !== expected.modelId ||
    adapterPhotoRoute(adapter) !== expected.route ||
    isUnsupportedPhotoStrategy(strategy)
  )
    throw new AndroidPhotoSendRejection('recipient_changed');
}

export async function resolveAndroidPhotoRoute(
  providerName: string,
  modelId: string,
): Promise<AndroidPhotoRoute | null> {
  try {
    const { getModelCapabilities } = await import(
      '@/lib/provider/staticModels'
    );
    if (!getModelCapabilities(modelId).supportsVision) return null;
    const [{ specializedStorage }, { ProviderRegistry }] = await Promise.all([
      import('@/lib/storage'),
      import('@/lib/llm/ProviderRegistry'),
    ]);
    const modelStrategy = await specializedStorage.models.getModelStrategy(
      providerName,
      modelId,
    );
    const strategy =
      modelStrategy ||
      (await specializedStorage.models.getProviderDefaultStrategy(
        providerName,
      ));
    const adapter = ProviderRegistry.get(providerName);
    if (!adapter || isUnsupportedPhotoStrategy(strategy ?? null)) return null;

    if (strategy) {
      const { providerRepository } = await import(
        '@/lib/provider/ProviderRepository'
      );
      const provider = (await providerRepository.getAll()).find(
        ({ name }) => name === providerName,
      );
      // Keyless single-strategy providers bypass delegation in the interpreter.
      if (!provider || provider.requiresKey || provider.strategy === 'multi') {
        return strategy === 'openai-compatible' || strategy === 'gemini'
          ? strategy
          : null;
      }
    }
    // A multi-strategy adapter without an explicit route is not verified for photo sends.
    return adapterPhotoRoute(adapter);
  } catch {
    // A route we cannot verify is not safe to offer as photo-capable.
  }
  return null;
}
