import { Migration } from '../types';

export const migration_018: Migration = {
  version: 18,
  name: 'agent_run_lineage',
  description: 'Link continuation and regeneration runs to their recorded source',
  up: [
    { type: 'ensureColumns', tableName: 'agent_runs', columns: [
      { name: 'parent_run_id', type: 'TEXT' },
      { name: 'run_kind', type: 'TEXT', notNull: true, defaultValue: 'normal' },
    ] },
    { type: 'rawSQL', sql: 'CREATE INDEX IF NOT EXISTS idx_agent_runs_parent ON agent_runs(parent_run_id);' },
  ],
  down: [{ type: 'rawSQL', sql: 'DROP INDEX IF EXISTS idx_agent_runs_parent;' }],
};
