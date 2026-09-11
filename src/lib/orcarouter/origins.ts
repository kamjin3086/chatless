/**
 * OrcaRouter origin policy.
 *
 * Authentication and inference live on two different public origins. The relay is
 * `https://api.orcarouter.ai/v1`; the auth endpoints are `https://www.orcarouter.ai/api/v1/auth`.
 * Never derive one origin from the other by swapping a hostname or appending `/v1`.
 */

export const ORCA_DEFAULT_AUTH_BASE = 'https://www.orcarouter.ai';
export const ORCA_DEFAULT_API_BASE = 'https://api.orcarouter.ai/v1';

/** Fixed paths on the auth origin. */
export const ORCA_AUTHORIZE_PATH = '/auth';
export const ORCA_EXCHANGE_PATH = '/api/v1/auth/keys';

export interface OrcaOrigins {
  /** Origin that serves the consent screen and the code exchange. */
  authBase: string;
  /** Origin + `/v1` that serves inference and the model catalog. */
  apiBase: string;
}

export class OrcaOriginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrcaOriginError';
  }
}

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

/**
 * Validate a configured base URL. Remote origins must be HTTPS; plain HTTP is only
 * tolerated for loopback development addresses.
 */
export function assertSecureOrigin(raw: string, label: string): string {
  const value = String(raw || '')
    .trim()
    .replace(/\/+$/, '');
  if (!value) throw new OrcaOriginError(`${label} is empty`);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OrcaOriginError(`${label} is not a valid URL`);
  }
  if (url.protocol === 'https:') return value;
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return value;
  throw new OrcaOriginError(
    `${label} must use HTTPS (HTTP is allowed for loopback only)`,
  );
}

/**
 * Resolve the auth and inference origins.
 *
 * Precedence for each origin: the explicit override, then the shared self-hosted base,
 * then the public default. Explicit values always win.
 */
export function resolveOrcaOrigins(
  env?: Record<string, string | undefined>,
): OrcaOrigins {
  const e = env ?? (typeof process !== 'undefined' ? process.env : {}) ?? {};
  const shared = String(e.ORCA_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');

  const authRaw =
    String(e.ORCA_AUTH_BASE_URL || '').trim() ||
    shared ||
    ORCA_DEFAULT_AUTH_BASE;
  const apiRaw =
    String(e.ORCA_API_BASE_URL || '').trim() || shared || ORCA_DEFAULT_API_BASE;

  return {
    authBase: assertSecureOrigin(authRaw, 'ORCA_AUTH_BASE_URL'),
    apiBase: assertSecureOrigin(apiRaw, 'ORCA_API_BASE_URL'),
  };
}

/** Absolute authorize URL on the auth origin. */
export function buildAuthorizeUrl(
  origins: OrcaOrigins,
  params: {
    callbackUrl: string;
    codeChallenge: string;
    state: string;
    appName: string;
    scope?: string;
    loginHint?: string;
    workspaceHint?: string;
  },
): string {
  const url = new URL(ORCA_AUTHORIZE_PATH, origins.authBase);
  url.searchParams.set('callback_url', params.callbackUrl);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', params.state);
  url.searchParams.set('app_name', params.appName);
  url.searchParams.set('scope', params.scope || 'api');
  if (params.loginHint) url.searchParams.set('login_hint', params.loginHint);
  if (params.workspaceHint)
    url.searchParams.set('workspace_hint', params.workspaceHint);
  return url.toString();
}

/** Absolute exchange URL on the auth origin. */
export function buildExchangeUrl(origins: OrcaOrigins): string {
  return new URL(ORCA_EXCHANGE_PATH, origins.authBase).toString();
}
