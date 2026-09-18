import type { Evidence } from './evidenceTypes';

const registries = new Map<string, Map<string, Evidence>>();

export function getEvidenceRegistry(runId: string): Map<string, Evidence> {
  let reg = registries.get(runId);
  if (!reg) {
    reg = new Map();
    registries.set(runId, reg);
  }
  return reg;
}

export function registerEvidence(runId: string, items: Evidence[]): Evidence[] {
  const reg = getEvidenceRegistry(runId);
  const start = Math.max(0, ...Array.from(reg.keys()).map((id) => Number(id.slice(1)) || 0));
  return items.map((item, i) => {
    // Evidence IDs are scoped to an Agent run. Never reuse an ID from a
    // previous search round, otherwise a later search silently changes the
    // meaning of an already emitted citation.
    const id = `E${start + i + 1}`;
    const next = { ...item, id };
    reg.set(id, next);
    return next;
  });
}

/** Restore immutable citation snapshots when a stopped run is continued. */
export function restoreEvidence(runId: string, items: Evidence[]): void {
  const reg = getEvidenceRegistry(runId);
  for (const item of items) {
    if (item.id && !reg.has(item.id)) reg.set(item.id, { ...item });
  }
}

export function listEvidence(runId: string): Evidence[] {
  return Array.from(registries.get(runId)?.values() || []);
}

export function readEvidence(runId: string, evidenceId: string): Evidence | undefined {
  return registries.get(runId)?.get(evidenceId);
}

export function clearEvidenceRegistry(runId: string): void {
  registries.delete(runId);
}
