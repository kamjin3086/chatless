/**
 * One answer to "does this provider need an API key?".
 *
 * The question was being asked five ways - the send path, the registry build, the status
 * badge, the add-provider default and the aggregate provider - and they disagreed, which is
 * how keyless endpoints (LM Studio, Ollama, a gateway on the LAN) got blocked with a message
 * about a missing key. Precedence is deliberate:
 *
 * 1. what the user chose for this provider, because they are the one who knows the endpoint;
 * 2. what the built-in catalogue says, when nobody chose;
 * 3. otherwise local-first: Ollama, or an endpoint on localhost or a private network, needs
 *    nothing; anything that looks like a hosted API is assumed to.
 */
export type KeyRequirementSource = 'stored' | 'catalog' | 'strategy-default';

const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** Loopback, a private network, or an IPv6 literal - the shapes a self-hosted endpoint takes. */
export function isLocalEndpoint(url?: string | null): boolean {
  const raw = String(url ?? '').trim();
  if (!raw) return false;
  let host = '';
  try {
    host = new URL(
      raw.includes('://') ? raw : `http://${raw}`,
    ).hostname.toLowerCase();
  } catch {
    return false;
  }
  host = host.replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (host.includes(':')) return true;
  return (
    host === 'localhost' || host.endsWith('.localhost') || PRIVATE_V4.test(host)
  );
}

export function resolveRequiresKey(args: {
  stored?: unknown;
  catalog?: unknown;
  strategy?: string | null;
  url?: string | null;
}): { requiresKey: boolean; source: KeyRequirementSource } {
  if (typeof args.stored === 'boolean') {
    return { requiresKey: args.stored, source: 'stored' };
  }
  // Local evidence outranks the catalogue label: the catalogue describes the service people
  // buy, while the address in front of us describes the endpoint they actually pointed at.
  // A self-hosted gateway filed under a hosted default would otherwise stay blocked, and if
  // it really does need a credential the endpoint says so with a 401 instead of us guessing
  // on its behalf before the request is even built.
  if (isLocalEndpoint(args.url)) {
    return { requiresKey: false, source: 'strategy-default' };
  }
  if (typeof args.catalog === 'boolean') {
    return { requiresKey: args.catalog, source: 'catalog' };
  }
  if (String(args.strategy ?? '').toLowerCase() === 'ollama') {
    return { requiresKey: false, source: 'strategy-default' };
  }
  return { requiresKey: true, source: 'strategy-default' };
}

/** Is the key requirement met? A blank string is no key, not a key. */
export function keyIsSatisfied(args: {
  requiresKey: boolean;
  apiKey?: string | null;
}): boolean {
  if (!args.requiresKey) return true;
  return String(args.apiKey ?? '').trim().length > 0;
}
