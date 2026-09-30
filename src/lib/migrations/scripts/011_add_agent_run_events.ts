import { Migration } from '../types';

export const migration_011: Migration = {
  version: 11,
  name: 'add_agent_run_events',
  description: 'Persist agent run metadata and event log for harness recovery',

  up: [
    {
      type: 'rawSQL',
      sql: `
        CREATE TABLE IF NOT EXISTS agent_runs (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          assistant_message_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          metadata TEXT DEFAULT '{}'
        );
      `,
    },
    {
      type: 'rawSQL',
      sql: `
        CREATE TABLE IF NOT EXISTS agent_run_events (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
        );
      `,
    },
    {
      type: 'rawSQL',
      sql: `CREATE INDEX IF NOT EXISTS idx_agent_run_events_run_seq ON agent_run_events(run_id, seq);`,
    },
    {
      type: 'rawSQL',
      sql: `CREATE INDEX IF NOT EXISTS idx_agent_runs_conversation ON agent_runs(conversation_id, started_at DESC);`,
    },
  ],

  down: [
    { type: 'rawSQL', sql: 'DROP INDEX IF EXISTS idx_agent_runs_conversation;' },
    { type: 'rawSQL', sql: 'DROP INDEX IF EXISTS idx_agent_run_events_run_seq;' },
    { type: 'rawSQL', sql: 'DROP TABLE IF EXISTS agent_run_events;' },
    { type: 'rawSQL', sql: 'DROP TABLE IF EXISTS agent_runs;' },
  ],
};
