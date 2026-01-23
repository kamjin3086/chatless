import { Migration } from '../types';

// 版本: 8
// - 为 conversations 新增 tool_mode 字段（chat/agent），用于控制“是否注入 tools”
export const migration_008: Migration = {
  version: 8,
  name: 'add_conversation_tool_mode',
  description: 'Add conversations.tool_mode for per-conversation agent/tools toggle',

  up: [
    {
      type: 'ensureColumns',
      tableName: 'conversations',
      columns: [{ name: 'tool_mode', type: 'TEXT' }],
    },
  ],

  down: [
    {
      type: 'rawSQL',
      sql: `-- SQLite cannot drop columns directly; no-op rollback for added columns.`,
    },
  ],
};


