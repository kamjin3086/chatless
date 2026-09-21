import { normalizeDirectoryPath } from './allowlist';
import type { AllowlistDirectory, AllowlistPermissions } from './types';

/**
 * Directories the user allowed for the current conversation only.
 *
 * They deliberately live in memory: "this session" must not become permanent
 * trust, and they are never written to the backend allowlist.  Each call that
 * touches one of them still travels as a call-scoped grant, exactly like the
 * session working directory.
 */

/** Everyday work in a folder the user just approved: create and edit, never delete. */
export const SESSION_DIRECTORY_PERMISSIONS: AllowlistPermissions = {
  read: true,
  write: true,
  create: true,
  delete: false,
};

const grants = new Map<string, Map<string, AllowlistDirectory>>();

function normaliseConversationId(conversationId: string): string {
  return String(conversationId || '').trim();
}

export function grantSessionDirectory(
  conversationId: string,
  directoryPath: string,
  permissions: AllowlistPermissions = SESSION_DIRECTORY_PERMISSIONS,
): AllowlistDirectory | null {
  const cid = normaliseConversationId(conversationId);
  const path = normalizeDirectoryPath(directoryPath);
  if (!cid || !path) return null;

  const forConversation = grants.get(cid) || new Map<string, AllowlistDirectory>();
  const existing = forConversation.get(path);
  const entry: AllowlistDirectory = {
    id: existing?.id || `session:${cid}:${path}`,
    path,
    ...(existing?.alias ? { alias: existing.alias } : null),
    permissions: { ...permissions },
    source: 'session',
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
  } as AllowlistDirectory;
  forConversation.set(path, entry);
  grants.set(cid, forConversation);
  return entry;
}

export function getSessionDirectories(conversationId: string): AllowlistDirectory[] {
  const cid = normaliseConversationId(conversationId);
  if (!cid) return [];
  return Array.from(grants.get(cid)?.values() || []);
}

export function revokeSessionDirectory(conversationId: string, directoryPath: string): void {
  const cid = normaliseConversationId(conversationId);
  const path = normalizeDirectoryPath(directoryPath);
  if (!cid || !path) return;
  grants.get(cid)?.delete(path);
}

export function clearSessionDirectories(conversationId: string): void {
  const cid = normaliseConversationId(conversationId);
  if (!cid) return;
  grants.delete(cid);
}
