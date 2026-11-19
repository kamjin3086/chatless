import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SqliteBridge } from '../../../../docs/acceptance/sqliteBridge';
import { migration_020 } from '@/lib/migrations/scripts/020_delivered_evidence';
import {
  clearEvidenceRegistry,
  listEvidence,
  registerEvidence,
} from '../EvidenceRegistry';
import {
  persistEvidenceSnapshots,
  restoreDeliveredEvidence,
} from '../evidenceSnapshots';
import type { Evidence } from '../evidenceTypes';

const manager = vi.hoisted(() => ({ select: vi.fn(), execute: vi.fn() }));
vi.mock('@/lib/database/services/DatabaseService', () => ({
  DatabaseService: { getInstance: () => ({ getDbManager: () => manager }) },
}));
let db: SqliteBridge;
const source: Evidence = {
  id: 'candidate',
  documentId: 'doc',
  documentName: 'source.txt',
  documentHash: 'hash',
  sourceBlockIds: ['block'],
  retrievalChunkId: 'chunk',
  quote: 'exact',
  score: 1,
  locator: { lineStart: 1 },
  range: {
    documentId: 'doc',
    batchId: 'batch',
    chunks: [{ chunkId: 'chunk', chunkIndex: 3, startOffset: 2, endOffset: 7 }],
  },
};
beforeEach(async () => {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  db = new SqliteBridge(':memory:');
  manager.select.mockImplementation((sql: string, params: unknown[]) =>
    db.select(sql, params),
  );
  manager.execute.mockImplementation((sql: string, params: unknown[]) =>
    db.query(sql, params),
  );
  await db.query('PRAGMA foreign_keys = ON');
  await db.query(
    'CREATE TABLE agent_runs (id TEXT PRIMARY KEY, conversation_id TEXT, parent_run_id TEXT)',
  );
  await db.query(
    "INSERT INTO agent_runs VALUES ('parent','conv',NULL),('child','conv','parent'),('grandchild','conv','child'),('foreign','other','parent')",
  );
  for (const operation of migration_020.up) {
    if (operation.type === 'rawSQL')
      for (const sql of typeof operation.sql === 'string'
        ? [operation.sql]
        : operation.sql)
        await db.query(sql);
  }
});
afterEach(async () => {
  await db.close();
  vi.unstubAllGlobals();
  for (const run of ['parent', 'child', 'grandchild', 'foreign'])
    clearEvidenceRegistry(run);
});

it('restores only acknowledged deliveries, including exact ranges, across multiple restarts', async () => {
  await persistEvidenceSnapshots(
    'parent',
    registerEvidence('parent', [source, { ...source, quote: 'not delivered' }]),
  );
  clearEvidenceRegistry('parent');
  await restoreDeliveredEvidence('parent', 'child', 'conv');
  expect(listEvidence('child')).toEqual([]);
  await db.query(
    "UPDATE agent_delivered_evidence SET delivered=1 WHERE run_id='parent' AND evidence_id='E1'",
  );
  await restoreDeliveredEvidence('parent', 'child', 'conv');
  expect(listEvidence('child')).toEqual([{ ...source, id: 'E1' }]);
  clearEvidenceRegistry('child');
  await restoreDeliveredEvidence('child', 'grandchild', 'conv');
  expect(listEvidence('grandchild')[0].range).toEqual(source.range);
  expect(registerEvidence('grandchild', [source])[0].id).toBe('E2');
});

it('does not restore evidence across conversations or unrelated lineage', async () => {
  await persistEvidenceSnapshots(
    'parent',
    registerEvidence('parent', [source]),
    true,
  );
  await restoreDeliveredEvidence('parent', 'foreign', 'conv');
  await restoreDeliveredEvidence('parent', 'grandchild', 'conv');
  expect(listEvidence('foreign')).toEqual([]);
  expect(listEvidence('grandchild')).toEqual([]);
});

it('rejects corrupt range metadata rather than inventing a new source identity', async () => {
  await persistEvidenceSnapshots(
    'parent',
    registerEvidence('parent', [source]),
    true,
  );
  await db.query(
    "UPDATE agent_delivered_evidence SET payload=json_set(payload,'$.range.documentId','different')",
  );
  await expect(
    restoreDeliveredEvidence('parent', 'child', 'conv'),
  ).rejects.toThrow('Corrupt delivered source range');
  expect(listEvidence('child')).toEqual([]);
});
