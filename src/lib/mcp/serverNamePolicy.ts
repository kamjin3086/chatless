import { normalizeServerName } from "./toolNaming";

export const RESERVED_MCP_SERVER_NAMES = new Set(['filesystem', 'skills', 'web_search', 'shell_executor']);

export type ServerRename = { from: string; to: string; reason: 'reserved' | 'duplicate' };

function isReserved(name: string): boolean {
  const n = String(name || '').trim().toLowerCase();
  return RESERVED_MCP_SERVER_NAMES.has(n);
}

function candidateExternalName(base: string): string {
  return `${base}_external`;
}

export function resolveNonConflictingServerName(params: {
  desiredName: string;
  existingNames: Iterable<string>;
  /**
   * Names claimed by builtin extensions (registry.serverClaim spellings).
   * Passed in by the call site so this module stays import-free of the
   * extension tree (serverNamePolicy ← extensions/registry is already an
   * edge; making it a cycle through assembly would be worse). A claimed
   * name renames exactly like a reserved one: the bridge would route it
   * before the external adapter, so keeping it means a silently uncallable
   * server.
   */
  claimedNames?: Iterable<string>;
}): { name: string; renames: ServerRename[] } {
  const desired = String(params.desiredName || '').trim();
  const existing = new Set(Array.from(params.existingNames || []).map((s) => String(s)));
  const claimed = new Set(
    Array.from(params.claimedNames || []).map((s) =>
      String(s || '').trim().toLowerCase(),
    ),
  );
  const renames: ServerRename[] = [];

  if (!desired) return { name: '', renames };

  let name = desired;
  const isClaimed = (n: string) =>
    claimed.has(String(n).trim().toLowerCase()) ||
    claimed.has(normalizeServerName(n));
  if (isReserved(name) || isClaimed(name)) {
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

export function normalizeSavedServers<T extends { name: string }>(
  list: T[],
  /** Claimed extension spellings (assembly.claimedExternalServerNames). */
  claimedNames?: Iterable<string>,
): { list: T[]; renames: ServerRename[] } {
  const out: T[] = [];
  const used = new Set<string>();
  const renames: ServerRename[] = [];

  for (const item of Array.isArray(list) ? list : []) {
    const desired = String(item?.name || '').trim();
    if (!desired) continue;
    const { name, renames: rs } = resolveNonConflictingServerName({
      desiredName: desired,
      existingNames: used,
      claimedNames,
    });
    if (!name) continue;
    used.add(name);
    if (rs.length) renames.push(...rs);
    out.push({ ...(item as any), name });
  }

  return { list: out, renames };
}

