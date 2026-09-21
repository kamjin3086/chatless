import { setServerAutoAuthorize, shouldAutoAuthorize } from '@/lib/mcp/authorizationConfig';

/**
 * How much the agent may touch the filesystem without asking.
 *
 * - `ask`: paths inside the working directory or an allowlisted folder run
 *   directly, anything else asks once and offers the user a longer grant.
 * - `unrestricted`: no prompts at all for the rest of the scope. Meant for long
 *   unattended runs; the backend still validates every path it receives.
 */
export type FilesystemAccessLevel = 'ask' | 'unrestricted';

/** Canonical server name used for the persisted switch. */
const FILESYSTEM_SERVER = 'fs';

/** Conversation-scoped overrides, memory only: "this session" must not stick. */
const conversationLevels = new Map<string, FilesystemAccessLevel>();

function normalizeConversationId(conversationId: string): string {
  return String(conversationId || '').trim();
}

export function setConversationFilesystemAccess(
  conversationId: string,
  level: FilesystemAccessLevel,
): void {
  const cid = normalizeConversationId(conversationId);
  if (!cid) return;
  if (level === 'ask') conversationLevels.delete(cid);
  else conversationLevels.set(cid, level);
}

export function getConversationFilesystemAccess(
  conversationId: string,
): FilesystemAccessLevel | undefined {
  const cid = normalizeConversationId(conversationId);
  if (!cid) return undefined;
  return conversationLevels.get(cid);
}

export function clearConversationFilesystemAccess(conversationId: string): void {
  conversationLevels.delete(normalizeConversationId(conversationId));
}

/** The persisted preference, shared with the settings page. */
export async function getGlobalFilesystemAccess(): Promise<FilesystemAccessLevel> {
  try {
    return (await shouldAutoAuthorize(FILESYSTEM_SERVER)) ? 'unrestricted' : 'ask';
  } catch {
    return 'ask';
  }
}

export async function setGlobalFilesystemAccess(level: FilesystemAccessLevel): Promise<void> {
  await setServerAutoAuthorize(FILESYSTEM_SERVER, level === 'unrestricted');
}

/** Conversation choice first, persisted preference otherwise. */
export async function resolveFilesystemAccess(
  conversationId: string,
): Promise<FilesystemAccessLevel> {
  const explicit = getConversationFilesystemAccess(conversationId);
  if (explicit) return explicit;
  return getGlobalFilesystemAccess();
}
