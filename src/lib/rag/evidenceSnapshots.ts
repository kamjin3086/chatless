import { DatabaseService } from '@/lib/database/services/DatabaseService';
import type { Evidence } from './evidenceTypes';
import { restoreEvidence } from './EvidenceRegistry';

function nativeRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Save before returning a tool delivery. Native event persistence acknowledges
 * only snapshots whose knowledge tool output was durably recorded.
 */
export async function persistEvidenceSnapshots(
  runId: string,
  evidence: Evidence[],
  delivered = false,
): Promise<void> {
  if (!nativeRuntime()) return;
  const db = DatabaseService.getInstance().getDbManager();
  for (const item of evidence) {
    await db.execute(
      `INSERT INTO agent_delivered_evidence (run_id,evidence_id,payload,created_at,delivered)
      VALUES (?,?,?,?,?) ON CONFLICT(run_id,evidence_id) DO NOTHING`,
      [runId, item.id, JSON.stringify(item), Date.now(), delivered ? 1 : 0],
    );
  }
}

/** Carry the complete acknowledged mapping through run lineage, not only the
 * citations that happened to appear in a finished answer.
 */
export async function restoreDeliveredEvidence(
  parentRunId: string,
  runId: string,
  conversationId: string,
): Promise<void> {
  if (!nativeRuntime()) return;
  const rows = await DatabaseService.getInstance()
    .getDbManager()
    .select<{ evidence_id: string; payload: string }>(
      `SELECT e.evidence_id,e.payload FROM agent_delivered_evidence e
      JOIN agent_runs parent ON parent.id = e.run_id
      JOIN agent_runs child ON child.id = ? AND child.parent_run_id = parent.id
      WHERE e.run_id = ? AND e.delivered = 1 AND parent.conversation_id = ? AND child.conversation_id = ? ORDER BY e.created_at,e.rowid`,
      [runId, parentRunId, conversationId, conversationId],
    );
  const evidence = rows.map((row) => {
    const item = JSON.parse(row.payload) as Evidence;
    if (
      !item ||
      item.id !== row.evidence_id ||
      typeof item.documentId !== 'string' ||
      typeof item.quote !== 'string' ||
      !Array.isArray(item.sourceBlockIds)
    )
      throw new Error('Corrupt evidence snapshot');
    if (
      item.range &&
      (item.range.documentId !== item.documentId ||
        !item.range.batchId ||
        !Array.isArray(item.range.chunks) ||
        item.range.chunks.some(
          (chunk) =>
            !chunk.chunkId ||
            !Number.isInteger(chunk.chunkIndex) ||
            chunk.chunkIndex < 0 ||
            !Number.isInteger(chunk.startOffset) ||
            !Number.isInteger(chunk.endOffset) ||
            chunk.startOffset < 0 ||
            chunk.endOffset <= chunk.startOffset,
        ))
    ) {
      throw new Error('Corrupt delivered source range');
    }
    return item;
  });
  await persistEvidenceSnapshots(runId, evidence, true);
  restoreEvidence(runId, evidence);
}
