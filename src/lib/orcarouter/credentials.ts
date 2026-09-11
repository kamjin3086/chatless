/**
 * The credential seam.
 *
 * Both authentication choices — a pasted API key and an OAuth 2.0 + PKCE connect flow —
 * are adapters over this one interface. Downstream provider requests and model discovery
 * consume `CredentialResult` and never learn where the key came from.
 */

/** Identity of the provider id that owns the credential. */
export type OrcaAuthMethod = 'api-key' | 'pkce';

export interface CredentialResult {
  /** The durable OrcaRouter API key (`sk-orca-…`). Never log this. */
  key: string;
  method: OrcaAuthMethod;
  /** Stable id for the credential owner, used to scope reauth transitions. */
  accountId: string;
  /**
   * Monotonic credential generation. Bumped on every successful acquisition so a late
   * failure from an older request can never mark a newer credential as broken.
   */
  generation: number;
  scope: string;
  createdAt: number;
  needsReauth: boolean;
}

export interface CredentialProvider {
  readonly method: OrcaAuthMethod;
  /** True when a usable credential is already stored. */
  hasCredential(): Promise<boolean>;
  /** Acquire a credential, or return the stored one when it is still usable. */
  acquire(): Promise<CredentialResult>;
  /** Remove the stored credential. */
  clear(): Promise<void>;
  /** Human-readable status for the settings UI. */
  describe(): Promise<{
    connected: boolean;
    accountId: string;
    needsReauth: boolean;
    redacted: string;
  }>;
}

export interface CredentialStore {
  read(providerId: string): Promise<StoredCredential | null>;
  write(providerId: string, value: StoredCredential): Promise<void>;
  remove(providerId: string): Promise<void>;
}

export interface StoredCredential {
  key: string;
  method: OrcaAuthMethod;
  accountId: string;
  generation: number;
  scope: string;
  createdAt: number;
  needsReauth: boolean;
}

export class CredentialUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialUnavailableError';
  }
}

/**
 * In-memory credential store used by tests and by runtimes without a durable store.
 * The production store delegates to the project's existing Tauri Store secret file.
 */
export class MemoryCredentialStore implements CredentialStore {
  private values = new Map<string, StoredCredential>();

  async read(providerId: string): Promise<StoredCredential | null> {
    return this.values.get(providerId) ?? null;
  }
  async write(providerId: string, value: StoredCredential): Promise<void> {
    this.values.set(providerId, { ...value });
  }
  async remove(providerId: string): Promise<void> {
    this.values.delete(providerId);
  }
}

/**
 * Mark exactly one credential generation as needing reauthentication.
 *
 * A rejected request carries the generation it was issued under. If the stored
 * credential has moved on (a newer login succeeded), the stale failure is dropped
 * instead of poisoning the fresh key.
 */
export async function markNeedsReauth(
  store: CredentialStore,
  providerId: string,
  rejectedGeneration: number,
): Promise<{ updated: boolean; accountId: string }> {
  const current = await store.read(providerId);
  if (!current) return { updated: false, accountId: '' };
  if (current.generation !== rejectedGeneration) {
    // A late failure from an old request must not mark a newly reauthorized credential.
    return { updated: false, accountId: current.accountId };
  }
  if (current.needsReauth)
    return { updated: false, accountId: current.accountId };
  await store.write(providerId, { ...current, needsReauth: true });
  return { updated: true, accountId: current.accountId };
}

/** Store from the project's existing secret mechanism (Tauri Store `llm-config.json`). */
export function createTauriCredentialStore(): CredentialStore {
  const keyOf = (providerId: string) =>
    `${providerId.toLowerCase()}_credential`;

  const readStorage = async (): Promise<Record<string, string>> => {
    const { default: StorageUtil } = await import('@/lib/storage');
    const raw = await StorageUtil.getItem<Record<string, string>>(
      keyOf('__index__'),
      null,
      'llm-config.json',
    );
    return raw || {};
  };

  return {
    async read(providerId: string) {
      const { default: StorageUtil } = await import('@/lib/storage');
      const blob = await StorageUtil.getItem<string>(
        keyOf(providerId),
        null,
        'llm-config.json',
      );
      if (!blob) return null;
      try {
        const parsed = JSON.parse(blob) as StoredCredential;
        if (!parsed || typeof parsed.key !== 'string') return null;
        return parsed;
      } catch {
        return null;
      }
    },
    async write(providerId: string, value: StoredCredential) {
      const { default: StorageUtil } = await import('@/lib/storage');
      await StorageUtil.setItem(
        keyOf(providerId),
        JSON.stringify(value),
        'llm-config.json',
      );
    },
    async remove(providerId: string) {
      const { default: StorageUtil } = await import('@/lib/storage');
      await StorageUtil.removeItem(keyOf(providerId), 'llm-config.json');
    },
  };
}

/** Shared bookkeeping used by both adapters: generation bump, reuse, reauth reset. */
export abstract class BaseCredentialProvider implements CredentialProvider {
  abstract readonly method: OrcaAuthMethod;

  constructor(
    protected readonly providerId: string,
    protected readonly store: CredentialStore,
  ) {}

  async hasCredential(): Promise<boolean> {
    const stored = await this.store.read(this.providerId);
    return !!(stored && stored.key && !stored.needsReauth);
  }

  abstract acquire(): Promise<CredentialResult>;

  async clear(): Promise<void> {
    await this.store.remove(this.providerId);
  }

  async describe() {
    const stored = await this.store.read(this.providerId);
    const { redactKey } = await import('./pkce');
    return {
      connected: !!(stored && stored.key && !stored.needsReauth),
      accountId: stored?.accountId || '',
      needsReauth: !!stored?.needsReauth,
      redacted: redactKey(stored?.key),
    };
  }

  /**
   * Persist a freshly acquired credential. The previous secret is only replaced once
   * the new one has been obtained, so a transient failure never destroys the old key.
   */
  protected async persist(
    key: string,
    method: OrcaAuthMethod,
    accountId: string,
    scope: string,
  ): Promise<CredentialResult> {
    const previous = await this.store.read(this.providerId);
    const generation = (previous?.generation ?? 0) + 1;
    const record: StoredCredential = {
      key,
      method,
      accountId,
      generation,
      scope,
      createdAt: Date.now(),
      needsReauth: false,
    };
    await this.store.write(this.providerId, record);
    return { ...record, method };
  }

  /** Reuse the stored key instead of minting a second one. */
  protected async reuse(): Promise<CredentialResult | null> {
    const stored = await this.store.read(this.providerId);
    if (!stored || !stored.key || stored.needsReauth) return null;
    return { ...stored };
  }
}
