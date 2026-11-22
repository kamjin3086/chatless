import { ANDROID_COUNTDOWN_SERVER } from './nativeTools/androidCountdown';
import { ANDROID_DIRECTORY_SERVER } from './nativeTools/androidDirectory';
import { ANDROID_DOCUMENT_SERVER } from './nativeTools/androidDocument';
import { isAndroidTauri } from '@/lib/utils/runtimePlatform';

const RESERVED_MCP_SERVER_NAMES = new Set(['filesystem', 'skills', 'web_search', 'shell_executor']);

export type ServerRename = { from: string; to: string; reason: 'reserved' | 'duplicate' };

export function isReservedMcpServerName(name: string): boolean {
  const normalizedName = String(name || '').toLowerCase();
  return RESERVED_MCP_SERVER_NAMES.has(normalizedName)
    || normalizedName === ANDROID_DOCUMENT_SERVER
    || normalizedName === ANDROID_DIRECTORY_SERVER
    || (normalizedName === ANDROID_COUNTDOWN_SERVER && isAndroidTauri());
}

function candidateExternalName(base: string): string {
  return `${base}_external`;
}

export function resolveNonConflictingServerName(params: {
  desiredName: string;
  existingNames: Iterable<string>;
}): { name: string; renames: ServerRename[] } {
  const desired = String(params.desiredName || '').trim();
  const existing = new Set(Array.from(params.existingNames || []).map((s) => String(s)));
  const renames: ServerRename[] = [];

  if (!desired) return { name: '', renames };

  let name = desired;
  if (isReservedMcpServerName(name)) {
    const base = String(name).trim();
    name = candidateExternalName(base);
    renames.push({ from: desired, to: name, reason: 'reserved' });
  }

  if (!existing.has(name)) return { name, renames };

  // duplicate: add numeric suffix
  let i = 2;
  let next = `${name}_${i}`;
  while (existing.has(next)) {
    i += 1;
    next = `${name}_${i}`;
  }
  renames.push({ from: desired, to: next, reason: renames.length ? renames[0].reason : 'duplicate' });
  return { name: next, renames };
}

export function normalizeSavedServers<T extends { name: string }>(list: T[]): { list: T[]; renames: ServerRename[] } {
  const out: T[] = [];
  const used = new Set<string>();
  const renames: ServerRename[] = [];

  for (const item of Array.isArray(list) ? list : []) {
    const desired = String(item?.name || '').trim();
    if (!desired) continue;
    const { name, renames: rs } = resolveNonConflictingServerName({ desiredName: desired, existingNames: used });
    if (!name) continue;
    used.add(name);
    if (rs.length) renames.push(...rs);
    out.push({ ...(item as any), name });
  }

  return { list: out, renames };
}

