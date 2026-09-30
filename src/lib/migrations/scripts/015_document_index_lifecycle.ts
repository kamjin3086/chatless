import { Migration } from '../types';

/** State required to publish and enhance a document index without exposing a
 * partially written batch. This migration intentionally starts a fresh
 * lifecycle for new indexes; legacy retrieval tables are not migrated. */
export const migration_015: Migration = {
  version: 15,
  name: 'document_index_lifecycle',
  description: 'Atomic document batches and persistent semantic jobs',
  up: [
    {
      type: 'ensureColumns',
      tableName: 'documents',
      columns: [
        { name: 'active_index_batch_id', type: 'TEXT' },
        { name: 'index_version', type: 'INTEGER', notNull: true, defaultValue: 0 },
        { name: 'lexical_status', type: 'TEXT', notNull: true, defaultValue: 'pending' },
        { name: 'semantic_status', type: 'TEXT', notNull: true, defaultValue: 'pending' },
      ],
    },
    { type: 'rawSQL', sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_document_one_active_batch
      ON document_index_batches(document_id) WHERE state = 'active';` },
    { type: 'rawSQL', sql: `CREATE TABLE IF NOT EXISTS document_index_tasks (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, document_version INTEGER NOT NULL,
      task_type TEXT NOT NULL, status TEXT NOT NULL, fingerprint TEXT,
      error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );` },
    { type: 'rawSQL', sql: `CREATE INDEX IF NOT EXISTS idx_document_index_tasks_queue
      ON document_index_tasks(task_type, status, created_at);` },
    { type: 'rawSQL', sql: `CREATE TABLE IF NOT EXISTS document_chunk_embeddings (
      chunk_id TEXT NOT NULL, batch_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
      dimension INTEGER NOT NULL, embedding BLOB NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (chunk_id, fingerprint),
      FOREIGN KEY (chunk_id) REFERENCES document_chunks(id) ON DELETE CASCADE,
      FOREIGN KEY (batch_id) REFERENCES document_index_batches(id) ON DELETE CASCADE
    );` },
    { type: 'rawSQL', sql: `CREATE INDEX IF NOT EXISTS idx_document_chunk_embeddings_batch
      ON document_chunk_embeddings(batch_id, fingerprint);` },
  ],
  down: [
    { type: 'rawSQL', sql: 'DROP TABLE IF EXISTS document_chunk_embeddings;' },
    { type: 'rawSQL', sql: 'DROP TABLE IF EXISTS document_index_tasks;' },
    { type: 'rawSQL', sql: 'DROP INDEX IF EXISTS idx_document_one_active_batch;' },
  ],
};
