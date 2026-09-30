import { Migration } from '../types';

/**
 * 版本: 10
 * 确保 vector_embeddings 表在迁移阶段创建，避免删除知识库时表不存在导致事务失败
 */
export const migration_010: Migration = {
  version: 10,
  name: 'add_vector_embeddings',
  description: 'Create vector_embeddings table for RAG vector storage',

  up: [
    {
      type: 'rawSQL',
      sql: `
        CREATE TABLE IF NOT EXISTS vector_embeddings (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          embedding BLOB NOT NULL,
          metadata TEXT DEFAULT '{}',
          dimension INTEGER NOT NULL,
          norm REAL,
          content_hash TEXT,
          created_at INTEGER DEFAULT (strftime('%s', 'now')),
          updated_at INTEGER DEFAULT (strftime('%s', 'now')),
          is_deleted INTEGER DEFAULT 0
        );
      `,
    },
    {
      type: 'rawSQL',
      sql: `
        CREATE INDEX IF NOT EXISTS idx_vector_embeddings_dimension
        ON vector_embeddings(dimension) WHERE is_deleted = 0;
      `,
    },
    {
      type: 'rawSQL',
      sql: `
        CREATE INDEX IF NOT EXISTS idx_vector_embeddings_content_hash
        ON vector_embeddings(content_hash) WHERE is_deleted = 0;
      `,
    },
    {
      type: 'rawSQL',
      sql: `
        CREATE INDEX IF NOT EXISTS idx_vector_embeddings_created_at
        ON vector_embeddings(created_at) WHERE is_deleted = 0;
      `,
    },
  ],

  down: [
    { type: 'rawSQL', sql: 'DROP INDEX IF EXISTS idx_vector_embeddings_created_at;' },
    { type: 'rawSQL', sql: 'DROP INDEX IF EXISTS idx_vector_embeddings_content_hash;' },
    { type: 'rawSQL', sql: 'DROP INDEX IF EXISTS idx_vector_embeddings_dimension;' },
    { type: 'rawSQL', sql: 'DROP TABLE IF EXISTS vector_embeddings;' },
  ],
};
