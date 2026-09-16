import { Migration } from '../types';

export const migration_012: Migration = {
  version: 12,
  name: 'evidence_rag_v2',
  description: 'Source blocks, retrieval chunks, FTS5, citations; invalidate legacy indexes',

  up: [
    {
      type: 'rawSQL',
      sql: `
        CREATE TABLE IF NOT EXISTS source_blocks (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          knowledge_base_id TEXT NOT NULL,
          block_index INTEGER NOT NULL,
          block_type TEXT NOT NULL,
          text TEXT NOT NULL,
          page INTEGER,
          section_path TEXT,
          line_start INTEGER,
          line_end INTEGER,
          char_start INTEGER,
          char_end INTEGER,
          metadata TEXT DEFAULT '{}',
          created_at INTEGER NOT NULL,
          FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
          FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
        );
      `,
    },
    {
      type: 'rawSQL',
      sql: `
        CREATE TABLE IF NOT EXISTS retrieval_chunks (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          knowledge_base_id TEXT NOT NULL,
          source_start_block INTEGER NOT NULL,
          source_end_block INTEGER NOT NULL,
          source_text TEXT NOT NULL,
          search_text TEXT NOT NULL,
          metadata TEXT DEFAULT '{}',
          created_at INTEGER NOT NULL,
          FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
          FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
        );
      `,
    },
    {
      type: 'rawSQL',
      sql: `
        CREATE VIRTUAL TABLE IF NOT EXISTS retrieval_chunks_fts USING fts5(
          chunk_id UNINDEXED,
          search_text,
          tokenize = 'unicode61'
        );
      `,
    },
    {
      type: 'rawSQL',
      sql: `CREATE INDEX IF NOT EXISTS idx_source_blocks_doc ON source_blocks(document_id, knowledge_base_id, block_index);`,
    },
    {
      type: 'rawSQL',
      sql: `CREATE INDEX IF NOT EXISTS idx_retrieval_chunks_kb ON retrieval_chunks(knowledge_base_id, document_id);`,
    },
    {
      type: 'ensureColumns',
      tableName: 'documents',
      columns: [
        { name: 'file_hash', type: 'TEXT' },
        { name: 'parser_version', type: 'TEXT' },
        { name: 'chunk_schema_version', type: 'TEXT' },
        { name: 'embedding_model', type: 'TEXT' },
        { name: 'embedding_dimension', type: 'INTEGER' },
        { name: 'embedding_fingerprint', type: 'TEXT' },
      ],
    },
    {
      type: 'ensureColumns',
      tableName: 'messages',
      columns: [{ name: 'citations', type: 'TEXT' }],
    },
    { type: 'rawSQL', sql: `DELETE FROM knowledge_chunks;` },
    { type: 'rawSQL', sql: `UPDATE vector_embeddings SET is_deleted = 1;` },
    {
      type: 'rawSQL',
      sql: `UPDATE documents
               SET is_indexed = 0,
                   embedding_model = NULL,
                   embedding_dimension = NULL,
                   embedding_fingerprint = NULL;`,
    },
    {
      type: 'rawSQL',
      sql: `UPDATE doc_knowledge_mappings SET status = 'pending';`,
    },
  ],

  down: [
    { type: 'rawSQL', sql: 'DROP TABLE IF EXISTS retrieval_chunks_fts;' },
    { type: 'rawSQL', sql: 'DROP INDEX IF EXISTS idx_retrieval_chunks_kb;' },
    { type: 'rawSQL', sql: 'DROP INDEX IF EXISTS idx_source_blocks_doc;' },
    { type: 'rawSQL', sql: 'DROP TABLE IF EXISTS retrieval_chunks;' },
    { type: 'rawSQL', sql: 'DROP TABLE IF EXISTS source_blocks;' },
  ],
};
