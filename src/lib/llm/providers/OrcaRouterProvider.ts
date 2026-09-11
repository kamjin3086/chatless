import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';

/**
 * OrcaRouter provider.
 *
 * Inference is plain OpenAI-compatible traffic against `https://api.orcarouter.ai/v1`, so
 * the request/streaming behaviour is inherited unchanged. Only model discovery differs:
 * the catalog is capability-filtered, and an authentication failure while listing models
 * marks the credential generation that made the request as needing reauthentication
 * instead of retrying against a dead key.
 */

import {
  fetchOrcaCatalog,
  type OrcaCapability,
} from '@/lib/orcarouter/catalog';

export class OrcaRouterProvider extends OpenAICompatibleProvider {
  /** Which capability bucket this instance's model list should describe. */
  private capability: OrcaCapability = 'chat';

  constructor(
    baseUrl: string,
    apiKey?: string,
    displayName: string = 'OrcaRouter',
  ) {
    super(baseUrl, apiKey, displayName);
  }

  withCapability(capability: OrcaCapability): this {
    this.capability = capability;
    return this;
  }

  /** Public read of the effective key, for model discovery callers outside the class. */
  async readApiKey(): Promise<string | null> {
    return this.getApiKey();
  }

  /**
   * List models from `GET /v1/models` on the inference origin.
   *
   * Returns `null` on failure so the shared service falls back to the verified static
   * seed; the seed is never mixed into a successful live response.
   */
  async fetchModels(): Promise<Array<{
    name: string;
    label?: string;
    aliases?: string[];
  }> | null> {
    const apiKey = (await this.getApiKey()) || undefined;
    const base = (this.baseUrl || '').replace(/\/+$/, '');
    if (!base) return null;

    try {
      const catalog = await fetchOrcaCatalog({
        apiBase: base,
        apiKey,
        capability: this.capability,
      });
      return catalog.models.map((m) => ({
        name: m.id,
        label: m.label,
        aliases: [m.id],
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/HTTP 401/.test(message)) {
        // A revoked or invalid durable key is terminal: reauthenticate, never refresh.
        await this.markCredentialNeedsReauth();
      }
      console.warn(
        '[OrcaRouterProvider] live model discovery failed, falling back to seed',
        message,
      );
      return null;
    }
  }

  /** Mark only the generation that produced the rejected request. */
  private async markCredentialNeedsReauth(): Promise<void> {
    try {
      const { createTauriCredentialStore, markNeedsReauth } = await import(
        '@/lib/orcarouter/credentials'
      );
      const store = createTauriCredentialStore();
      for (const providerId of ['orcarouter', 'orcarouter-oauth']) {
        const stored = await store.read(providerId);
        if (stored) await markNeedsReauth(store, providerId, stored.generation);
      }
    } catch {
      // Storage may be unavailable outside the desktop shell; the next request retries.
    }
  }
}
