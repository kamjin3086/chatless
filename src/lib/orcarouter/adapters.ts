/**
 * The two credential adapters over the seam declared in `credentials.ts`.
 *
 * `ApiKeyCredentialProvider` — the user pastes an existing `sk-orca-…` key.
 * `PkceCredentialProvider`    — the user signs in and a key is issued to this app.
 *
 * Both produce the identical `CredentialResult`. Downstream inference and model
 * discovery read that result and never branch on which adapter produced it.
 */

import {
  BaseCredentialProvider,
  CredentialUnavailableError,
  type CredentialResult,
  type CredentialStore,
  type OrcaAuthMethod,
} from './credentials';
import { OrcaAuthError, redactKey } from './pkce';
import {
  OrcaConnectController,
  type ConnectOptions,
  type OrcaFlow,
} from './connect';

/** Provider ids. Kept distinct so support, logout, and reauth stay unambiguous. */
export const ORCA_API_KEY_PROVIDER_ID = 'orcarouter';
export const ORCA_PKCE_PROVIDER_ID = 'orcarouter-oauth';

/**
 * True for either OrcaRouter provider entry.
 *
 * The two entries intentionally share one inference adapter and one catalog; only the
 * credential acquisition differs, and the user is shown both choices in one panel.
 */
export function isOrcaRouterProvider(providerName: string): boolean {
  const n = String(providerName || '')
    .trim()
    .toLowerCase();
  return (
    n === 'orcarouter - api' || n === 'orcarouter - auth' || n === 'orcarouter'
  );
}

/** Obvious-mistake check only. A prefix is not proof the key is valid. */
export function looksLikeOrcaKey(value: string): boolean {
  return /^sk-orca-[A-Za-z0-9._-]{8,}$/.test(String(value || '').trim());
}

/**
 * API-key adapter: the user supplies the key through the project's own secret field.
 * No PKCE login is started, and the key is stored wherever the project keeps secrets.
 */
export class ApiKeyCredentialProvider extends BaseCredentialProvider {
  readonly method: OrcaAuthMethod = 'api-key';

  constructor(
    store: CredentialStore,
    providerId: string = ORCA_API_KEY_PROVIDER_ID,
  ) {
    super(providerId, store);
  }

  /** Reuse the stored key rather than asking again on every screen open. */
  async acquire(): Promise<CredentialResult> {
    const existing = await this.reuse();
    if (existing) return existing;
    throw new CredentialUnavailableError('No API key has been saved yet.');
  }

  /**
   * Save a key the user typed. A malformed value is rejected with an actionable message;
   * validation is otherwise deferred to the first real request so no paid inference call
   * is made merely to make a settings form show "valid".
   */
  async save(apiKey: string): Promise<CredentialResult> {
    const value = String(apiKey || '').trim();
    if (!value)
      throw new CredentialUnavailableError('Enter your OrcaRouter API key.');
    if (!looksLikeOrcaKey(value)) {
      throw new CredentialUnavailableError(
        'That does not look like an OrcaRouter API key. Keys start with "sk-orca-".',
      );
    }
    // The account is unknown until a real request authenticates it, so scope the
    // credential to the key material itself rather than inventing an identity.
    const accountId = `key:${value.slice(0, 16)}`;
    return this.persist(value, 'api-key', accountId, 'api');
  }

  async describe() {
    const base = await super.describe();
    return {
      ...base,
      redacted: redactKey((await this.store.read(this.providerId))?.key),
    };
  }
}

/** Adapter that drives the PKCE connect controller and persists the issued key. */
export class PkceCredentialProvider extends BaseCredentialProvider {
  readonly method: OrcaAuthMethod = 'pkce';
  private controller: OrcaConnectController;

  constructor(
    store: CredentialStore,
    connectOptions: ConnectOptions = {},
    providerId: string = ORCA_PKCE_PROVIDER_ID,
  ) {
    super(providerId, store);
    this.controller = new OrcaConnectController(connectOptions);
  }

  /** Reuse the durable key. OrcaRouter issues a long-lived key, not a refresh token. */
  async acquire(): Promise<CredentialResult> {
    const existing = await this.reuse();
    if (existing) return existing;
    throw new CredentialUnavailableError(
      'Connect with OrcaRouter to issue a key first.',
    );
  }

  /** Begin a login. Returns the authorize URL the user must approve. */
  async begin(flow: OrcaFlow = 'oob') {
    return this.controller.start(flow);
  }

  async awaitCallback(attempt: number) {
    return this.controller.awaitCallback(attempt);
  }

  /** Exchange the code and persist the durable key. */
  async complete(attempt: number, code: string): Promise<CredentialResult> {
    const result = await this.controller.complete(attempt, code);
    return this.persist(
      result.key,
      'pkce',
      result.userId || 'orcarouter-user',
      result.scope,
    );
  }

  async cancel(attempt?: number): Promise<void> {
    await this.controller.cancel(attempt);
  }

  /** Synchronous cleanup for `pagehide` / back-forward-cache restores. */
  cancelSync(): void {
    this.controller.cancelSync();
  }

  isBusy(): boolean {
    return this.controller.isBusy();
  }

  /** A rejected durable key requires reauthentication, never a refresh attempt. */
  static isReauthRequired(error: unknown): boolean {
    return error instanceof OrcaAuthError && error.code === 'expired_or_used';
  }
}
