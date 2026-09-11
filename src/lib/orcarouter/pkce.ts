/**
 * PKCE primitives and the code-exchange client for OrcaRouter.
 *
 * The verifier is generated fresh for every attempt from a cryptographic RNG and never
 * leaves this process until the exchange. It is never placed in a URL, a log, an error
 * message, or telemetry. Only the S256 challenge travels on the authorize URL.
 */

const AUTH_CODE_TTL_NOTE = 'Auth codes are single-use with a 10 minute TTL.';

export class OrcaAuthError extends Error {
  readonly code:
    | 'denied'
    | 'state_mismatch'
    | 'expired_or_used'
    | 'method_mismatch'
    | 'scope'
    | 'rate_limited'
    | 'network'
    | 'cancelled'
    | 'timeout'
    | 'unknown';

  constructor(code: OrcaAuthError['code'], message: string) {
    super(message);
    this.name = 'OrcaAuthError';
    this.code = code;
  }
}

function getCrypto(): Crypto {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new OrcaAuthError(
      'unknown',
      'WebCrypto is unavailable in this runtime',
    );
  }
  return c;
}

/** base64url without padding. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  const b64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Fresh high-entropy verifier, 32 bytes of cryptographic randomness. */
export function generateVerifier(): string {
  const bytes = new Uint8Array(32);
  getCrypto().getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** Fresh opaque CSRF state token. */
export function generateState(): string {
  const bytes = new Uint8Array(16);
  getCrypto().getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** `base64url(sha256(verifier))`, no padding. */
export async function computeChallenge(verifier: string): Promise<string> {
  const digest = await getCrypto().subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Compare the echoed state against the one we sent, in constant time, before touching
 * the code. This is the only thing standing between our listener and a code somebody
 * else's page dropped on it.
 */
export function stateMatches(
  expected: string,
  received: string | null,
): boolean {
  if (
    typeof received !== 'string' ||
    received.length !== expected.length ||
    expected.length === 0
  ) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  return diff === 0;
}

export interface OrcaAuthCodeResult {
  /** Scope that was *granted* by the exchange response. */
  scope: string;
  /** OrcaRouter user id the key belongs to. */
  userId: string;
  /** The issued durable API key. Never logged. */
  key: string;
}

/** Read the granted scope and reject anything that cannot serve inference. */
export function assertUsableScope(scope: unknown, requested: string): string {
  const granted = typeof scope === 'string' ? scope.trim() : '';
  if (!granted) {
    throw new OrcaAuthError(
      'scope',
      'The authorization response did not report a granted scope.',
    );
  }
  if (granted !== requested) {
    throw new OrcaAuthError(
      'scope',
      `OrcaRouter granted scope "${granted}", but this app requested "${requested}". ` +
        'Your workspace role may not permit the wider grant.',
    );
  }
  return granted;
}

export interface ExchangeInput {
  code: string;
  verifier: string;
  exchangeUrl: string;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Exchange an auth code for a durable API key.
 *
 * Form encoding is accepted by the server too, but JSON keeps the verifier out of any
 * URL-encoded transcript readers. `code_challenge_method` is echoed so the server can
 * detect a downgrade.
 */
export async function exchangeCodeForKey(
  input: ExchangeInput,
): Promise<OrcaAuthCodeResult> {
  const doFetch = input.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(input.exchangeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: input.code,
        code_verifier: input.verifier,
        code_challenge_method: 'S256',
      }),
    });
  } catch {
    // Never surface the underlying transport error: it can embed the request body.
    throw new OrcaAuthError(
      'network',
      'Could not reach OrcaRouter to exchange the code.',
    );
  }

  if (!res.ok) {
    if (res.status === 400) {
      throw new OrcaAuthError(
        'method_mismatch',
        'OrcaRouter rejected the PKCE method for this code.',
      );
    }
    if (res.status === 403) {
      throw new OrcaAuthError(
        'expired_or_used',
        `This authorization code is not valid. ${AUTH_CODE_TTL_NOTE}`,
      );
    }
    if (res.status === 429) {
      throw new OrcaAuthError(
        'rate_limited',
        'Too many authorization attempts. Wait a few minutes and try again.',
      );
    }
    throw new OrcaAuthError(
      'unknown',
      `OrcaRouter rejected the code exchange (HTTP ${res.status}).`,
    );
  }

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new OrcaAuthError(
      'unknown',
      'OrcaRouter returned an unreadable exchange response.',
    );
  }

  const key = typeof data.key === 'string' ? data.key.trim() : '';
  if (!key)
    throw new OrcaAuthError(
      'unknown',
      'OrcaRouter did not return a key for this authorization.',
    );

  return {
    key,
    scope: assertUsableScope(data.scope, 'api'),
    userId: String(data.user_id ?? '').trim(),
  };
}

/** Redact a key for display. Never returns the full secret. */
export function redactKey(key: string | null | undefined): string {
  const v = String(key || '');
  if (!v) return '';
  if (v.length <= 12) return '••••';
  return `${v.slice(0, 8)}••••${v.slice(-4)}`;
}
