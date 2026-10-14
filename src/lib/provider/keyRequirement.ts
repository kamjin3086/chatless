/**
 * One answer to "does this provider need an API key?".
 *
 * The question was being asked five ways - the send path, the registry build, the status
 * badge, the add-provider default and the aggregate provider - and they disagreed, which is
 * how keyless endpoints (LM Studio, Ollama, a gateway on the LAN) got blocked with a message
 * about a missing key. The rule is deliberately short, because every extra knob here is a
 * setting the user has to understand:
 *
 * 1. an endpoint the user set up is keyless unless they say otherwise by filling in a key.
 *    Nobody adds a LAN endpoint expecting the app to demand a credential it cannot have;
 * 2. otherwise local evidence - loopback, a private network, an IPv6 literal, Ollama - needs
 *    nothing, even when the catalogue entry was written for a hosted service;
 * 3. otherwise the built-in catalogue's answer, and a missing answer means a key is required.
 *
 * A provider that does require a credential and does not have one is the case this governs;
 * a key that exists is always used, so hosted providers behave exactly as before.
 */
export type KeyRequirementSource = 'user-added' | 'local' | 'catalog' | 'default';

const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** Loopback, a private network, or an IPv6 literal - the shapes a self-hosted endpoint takes. */
export function isLocalEndpoint(url?: string | null): boolean {
  const raw = String(url ?? '').trim();
  if (!raw) return false;
  let host = '';
  try {
    host = new URL(raw.includes('://') ? raw : `http://${raw}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  host = host.replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (host.includes(':')) return true;
  return host === 'localhost' || host.endsWith('.localhost') || PRIVATE_V4.test(host);
}

export function resolveRequiresKey(args: {
  isUserAdded?: boolean;
  catalog?: unknown;
  strategy?: string | null;
  url?: string | null;
}): { requiresKey: boolean; source: KeyRequirementSource } {
  if (args.isUserAdded === true) {
    return { requiresKey: false, source: 'user-added' };
  }
  if (
    String(args.strategy ?? '').toLowerCase() === 'ollama' ||
    isLocalEndpoint(args.url)
  ) {
    return { requiresKey: false, source: 'local' };
  }
  if (typeof args.catalog === 'boolean') {
    return { requiresKey: args.catalog, source: 'catalog' };
  }
  return { requiresKey: true, source: 'default' };
}

/** Is the key requirement met? A blank string is no key, not a key. */
export function keyIsSatisfied(args: {
  requiresKey: boolean;
  apiKey?: string | null;
}): boolean {
  if (!args.requiresKey) return true;
  return String(args.apiKey ?? '').trim().length > 0;
}
