import { Migration } from '../types';

export const migration_016: Migration = {
  version: 16,
  name: 'tool_result_attachments',
  description: 'Store large tool results outside model context with scoped reads',
  up: [
    { type: 'rawSQL', sql: `CREATE TABLE IF NOT EXISTS tool_result_attachments (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, run_id TEXT NOT NULL, call_id TEXT NOT NULL,
      file_path TEXT NOT NULL, byte_size INTEGER NOT NULL, content_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    );` },
    { type: 'rawSQL', sql: `CREATE INDEX IF NOT EXISTS idx_tool_result_attachments_scope
      ON tool_result_attachments(conversation_id, run_id, created_at);` },
  ],
  down: [
    { type: 'rawSQL', sql: 'DROP INDEX IF EXISTS idx_tool_result_attachments_scope;' },
    { type: 'rawSQL', sql: 'DROP TABLE IF EXISTS tool_result_attachments;' },
  ],
};
