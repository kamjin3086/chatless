import { Migration } from '../types';

export const migration_013: Migration = {
  version: 13,
  name: 'add_agent_run_checkpoints',
  description: 'Store resumable context checkpoints and ordered run state',
  up: [
    {
      type: 'rawSQL',
      sql: `
        CREATE TABLE IF NOT EXISTS agent_run_checkpoints (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          kind TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
        );
      `,
    },
    {
      type: 'rawSQL',
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_run_checkpoints_run_seq ON agent_run_checkpoints(run_id, seq);`,
    },
    {
      type: 'rawSQL',
      sql: `CREATE INDEX IF NOT EXISTS idx_agent_run_checkpoints_run_created ON agent_run_checkpoints(run_id, created_at);`,
    },
    {
      type: 'rawSQL',
      // Older development builds could write duplicate sequence numbers before
      // event insertion moved into a Rust transaction. Repair deterministically
      // before creating the uniqueness boundary, otherwise the migration can
      // never be applied to the database that needs it most.
      sql: [
        'DROP INDEX IF EXISTS idx_agent_run_events_run_seq_unique;',
        `CREATE TABLE IF NOT EXISTS agent_run_event_seq_repair (
          id TEXT PRIMARY KEY,
          seq INTEGER NOT NULL
        );`,
        'DELETE FROM agent_run_event_seq_repair;',
        `INSERT INTO agent_run_event_seq_repair (id, seq)
         SELECT id, ROW_NUMBER() OVER (PARTITION BY run_id ORDER BY seq, created_at, id)
         FROM agent_run_events;`,
        `UPDATE agent_run_events
           SET seq = (SELECT seq FROM agent_run_event_seq_repair repair WHERE repair.id = agent_run_events.id);`,
        'DROP TABLE IF EXISTS agent_run_event_seq_repair;',
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_run_events_run_seq_unique ON agent_run_events(run_id, seq);',
      ],
    },
  ],
  down: [
    { type: 'rawSQL', sql: 'DROP INDEX IF EXISTS idx_agent_run_events_run_seq_unique;' },
    { type: 'rawSQL', sql: 'DROP INDEX IF EXISTS idx_agent_run_checkpoints_run_created;' },
    { type: 'rawSQL', sql: 'DROP INDEX IF EXISTS idx_agent_run_checkpoints_run_seq;' },
    { type: 'rawSQL', sql: 'DROP TABLE IF EXISTS agent_run_checkpoints;' },
  ],
};
