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
  const start = reg.size;
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

export function listEvidence(runId: string): Evidence[] {
  return Array.from(registries.get(runId)?.values() || []);
}

export function readEvidence(runId: string, evidenceId: string): Evidence | undefined {
  return registries.get(runId)?.get(evidenceId);
}

export function clearEvidenceRegistry(runId: string): void {
  registries.delete(runId);
}
