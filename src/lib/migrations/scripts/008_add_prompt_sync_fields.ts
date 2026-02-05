import { Migration } from '../types';

// 版本: 8
// 为 prompts 表补齐同步所需字段（软删除 tombstone + tie-break device_id）
export const migration_008: Migration = {
  version: 8,
  name: 'add_prompt_sync_fields',
  description: 'Add deleted_at and updated_by_device_id fields for prompts sync',

  up: [
    {
      type: 'ensureColumns',
      tableName: 'prompts',
      columns: [
        { name: 'deleted_at', type: 'INTEGER' },
        { name: 'updated_by_device_id', type: 'TEXT' },
      ],
    },
    { type: 'rawSQL', sql: `CREATE INDEX IF NOT EXISTS idx_prompts_updated_at ON prompts(updated_at);` },
    { type: 'rawSQL', sql: `CREATE INDEX IF NOT EXISTS idx_prompts_deleted_at ON prompts(deleted_at);` },
  ],

  down: [
    { type: 'rawSQL', sql: `DROP INDEX IF EXISTS idx_prompts_updated_at;` },
    { type: 'rawSQL', sql: `DROP INDEX IF EXISTS idx_prompts_deleted_at;` },
  ],
};

