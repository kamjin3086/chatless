import { Migration } from '../types';

/**
 * The v2 evidence tables duplicated every document for every knowledge base.
 * New indexes use this document-owned batch/chunk model; mappings only control
 * visibility. Legacy tables are deliberately left read-only for old data until
 * the user rebuilds an index.
 */
export const migration_014: Migration = {
  version: 14,
  name: 'document_owned_chunks',
  description: 'Document-level chunk batches, FTS and durable conversation attachments',
  up: [
    { type: 'rawSQL', sql: `CREATE TABLE IF NOT EXISTS document_index_batches (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, state TEXT NOT NULL,
      created_at INTEGER NOT NULL, activated_at INTEGER,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );` },
    { type: 'rawSQL', sql: `CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, batch_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL, source_text TEXT NOT NULL, search_text TEXT NOT NULL,
      locator TEXT NOT NULL DEFAULT '{}', metadata TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (batch_id) REFERENCES document_index_batches(id) ON DELETE CASCADE,
      UNIQUE(document_id, batch_id, chunk_index)
    );` },
    { type: 'rawSQL', sql: `CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(
      chunk_id UNINDEXED, search_text, tokenize='unicode61'
    );` },
    { type: 'rawSQL', sql: `CREATE TABLE IF NOT EXISTS conversation_document_mappings (
      conversation_id TEXT NOT NULL, document_id TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, document_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );` },
    { type: 'rawSQL', sql: [
      'CREATE INDEX IF NOT EXISTS idx_document_index_batches_active ON document_index_batches(document_id, state, activated_at);',
      'CREATE INDEX IF NOT EXISTS idx_document_chunks_document_batch ON document_chunks(document_id, batch_id, chunk_index);',
      'CREATE INDEX IF NOT EXISTS idx_conversation_document_mappings_conversation ON conversation_document_mappings(conversation_id, document_id);',
      "UPDATE documents SET is_indexed = 0 WHERE EXISTS (SELECT 1 FROM retrieval_chunks WHERE retrieval_chunks.document_id = documents.id);",
      "UPDATE doc_knowledge_mappings SET status = 'pending' WHERE status = 'indexed';",
    ] },
  ],
  down: [
    { type: 'rawSQL', sql: 'DROP TABLE IF EXISTS conversation_document_mappings;' },
    { type: 'rawSQL', sql: 'DROP TABLE IF EXISTS document_chunks_fts;' },
    { type: 'rawSQL', sql: 'DROP TABLE IF EXISTS document_chunks;' },
    { type: 'rawSQL', sql: 'DROP TABLE IF EXISTS document_index_batches;' },
  ],
};
