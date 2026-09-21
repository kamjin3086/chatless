import { setServerAutoAuthorize, shouldAutoAuthorize } from '@/lib/mcp/authorizationConfig';

/**
 * How much an agent capability may do without asking.
 *
 * - `ask`: every call that is not already covered asks the user once, and the
 *   card offers a longer grant.
 * - `unrestricted`: no prompts for the rest of the scope. Meant for long
 *   unattended runs; sandbox-side limits still apply.
 */
export type AccessLevel = 'ask' | 'unrestricted';

/** Capabilities the user can grant a trust level to. */
export type AccessScope = 'fs' | 'shell';

/** Canonical server name used for the persisted switch. */
const SERVER_NAME: Record<AccessScope, string> = {
  fs: 'fs',
  shell: 'shell',
};

/** Conversation-scoped overrides, memory only: "this session" must not stick. */
const conversationLevels = new Map<string, AccessLevel>();

function keyOf(scope: AccessScope, conversationId: string): string {
  return `${scope}:${String(conversationId || '').trim()}`;
}

export function setConversationAccess(
  scope: AccessScope,
  conversationId: string,
  level: AccessLevel,
): void {
  const key = keyOf(scope, conversationId);
  if (key.endsWith(':')) return;
  if (level === 'ask') conversationLevels.delete(key);
  else conversationLevels.set(key, level);
}

export function getConversationAccess(
  scope: AccessScope,
  conversationId: string,
): AccessLevel | undefined {
  const key = keyOf(scope, conversationId);
  if (key.endsWith(':')) return undefined;
  return conversationLevels.get(key);
}

export function clearConversationAccess(scope: AccessScope, conversationId: string): void {
  conversationLevels.delete(keyOf(scope, conversationId));
}

/** The persisted preference, shared with the settings page. */
export async function getGlobalAccess(scope: AccessScope): Promise<AccessLevel> {
  try {
    return (await shouldAutoAuthorize(SERVER_NAME[scope])) ? 'unrestricted' : 'ask';
  } catch {
    return 'ask';
  }
}

export async function setGlobalAccess(scope: AccessScope, level: AccessLevel): Promise<void> {
  await setServerAutoAuthorize(SERVER_NAME[scope], level === 'unrestricted');
}

/** Conversation choice first, persisted preference otherwise. */
export async function resolveAccess(
  scope: AccessScope,
  conversationId: string,
): Promise<AccessLevel> {
  const explicit = getConversationAccess(scope, conversationId);
  if (explicit) return explicit;
  return getGlobalAccess(scope);
}
