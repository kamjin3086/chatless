import type { Migration } from '../types';

export const migration_020: Migration = {
  version: 20,
  name: 'delivered_evidence',
  description:
    'Persist source identity and exact delivered ranges for resumed runs',
  up: [
    {
      type: 'rawSQL',
      sql: `CREATE TABLE agent_delivered_evidence (
    run_id TEXT NOT NULL, evidence_id TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, delivered INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (run_id, evidence_id), FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
  )`,
    },
  ],
  down: [
    { type: 'rawSQL', sql: 'DROP TABLE IF EXISTS agent_delivered_evidence' },
  ],
};
