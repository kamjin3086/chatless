import type { Migration } from '../types';

export const migration_019: Migration = {
  version: 19,
  name: 'semantic_model_identity',
  description:
    'Bind semantic work to an immutable model and repair duplicate active jobs',
  up: [
    {
      type: 'rawSQL',
      sql: 'ALTER TABLE document_index_tasks ADD COLUMN embedding_fingerprint TEXT;',
    },
    {
      type: 'rawSQL',
      sql: 'ALTER TABLE documents ADD COLUMN target_embedding_fingerprint TEXT;',
    },
    {
      type: 'rawSQL',
      sql: `UPDATE document_index_tasks SET status = 'cancelled', error = 'Superseded duplicate semantic job'
      WHERE task_type = 'semantic' AND status IN ('pending','running','waiting_model') AND EXISTS (
        SELECT 1 FROM document_index_tasks newer WHERE newer.document_id = document_index_tasks.document_id
        AND newer.document_version = document_index_tasks.document_version AND newer.task_type = 'semantic'
        AND newer.status IN ('pending','running','waiting_model') AND (
          newer.created_at > document_index_tasks.created_at OR
          (newer.created_at = document_index_tasks.created_at AND newer.id > document_index_tasks.id)))`,
    },
    {
      type: 'rawSQL',
      sql: `CREATE UNIQUE INDEX one_active_semantic_job
      ON document_index_tasks(document_id, document_version)
      WHERE task_type = 'semantic' AND status IN ('pending','running','waiting_model')`,
    },
  ],
};
