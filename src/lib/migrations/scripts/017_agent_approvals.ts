import { Migration } from '../types';

export const migration_017: Migration = {
  version: 17,
  name: 'agent_approvals',
  description: 'Durable call-scoped approval records',
  up: [{ type: 'rawSQL', sql: `CREATE TABLE IF NOT EXISTS agent_approvals (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL, conversation_id TEXT NOT NULL, call_id TEXT,
    server TEXT NOT NULL, tool TEXT NOT NULL, normalized_args TEXT NOT NULL, scope TEXT NOT NULL,
    status TEXT NOT NULL, created_at INTEGER NOT NULL, decided_at INTEGER,
    FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
  );` }],
  down: [{ type: 'rawSQL', sql: 'DROP TABLE IF EXISTS agent_approvals;' }],
};
