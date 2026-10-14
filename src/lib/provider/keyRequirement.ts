/**
 * One answer to "does this provider need an API key?".
 *
 * The question was being asked several ways - the send path, the registry build, the status
 * badge, the initial status written at startup and the aggregate provider - and they
 * disagreed, which is how keyless endpoints (LM Studio, Ollama, a gateway on the LAN) got
 * blocked with a message about a missing key. The rule is deliberately short, because every
 * extra knob here is a setting the user has to understand:
 *
 * 1. local evidence wins: loopback, a private network, an IPv6 literal, or the ollama
 *    strategy needs nothing. The address is the endpoint actually configured, whereas the
 *    catalogue describes the service people subscribe to, and a self-hosted gateway filed
 *    under a hosted default was the reported failure. If it does need a credential it
 *    answers 401, which is information from the endpoint rather than a guess made first;
 * 2. otherwise the catalogue's answer, because a hosted service the user switched on
 *    genuinely needs a key. This cannot be "did the user add it": enabling Azure or
 *    OpenRouter from the catalogue marks those as user-added too;
 * 3. otherwise the endpoint is the user's own and unlisted - no key filled in is the
 *    configuration, not a mistake.
 *
 * A provider that requires a credential and lacks one is what this governs; a key that
 * exists is always used, so nothing here changes how a configured provider behaves.
 */
export type KeyRequirementSource = 'local' | 'catalog' | 'custom';

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
  /** The catalogue's answer for this provider, or undefined when it is not in the catalogue. */
  catalog?: unknown;
  strategy?: string | null;
  url?: string | null;
}): { requiresKey: boolean; source: KeyRequirementSource } {
  if (
    String(args.strategy ?? '').toLowerCase() === 'ollama' ||
    isLocalEndpoint(args.url)
  ) {
    return { requiresKey: false, source: 'local' };
  }
  if (typeof args.catalog === 'boolean') {
    return { requiresKey: args.catalog, source: 'catalog' };
  }
  return { requiresKey: false, source: 'custom' };
}

/** Is the key requirement met? A blank string is no key, not a key. */
export function keyIsSatisfied(args: {
  requiresKey: boolean;
  apiKey?: string | null;
}): boolean {
  if (!args.requiresKey) return true;
  return String(args.apiKey ?? '').trim().length > 0;
}
