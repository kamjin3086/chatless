import type { Migration } from '../types';

export const migration_021: Migration = {
  version: 21,
  name: 'android_document_attachments',
  description: 'Retain one locally extracted Android document per conversation',
  up: [
    {
      type: 'rawSQL',
      sql: `CREATE TABLE android_document_attachments (
        conversation_id TEXT NOT NULL PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
        handle TEXT NOT NULL,
        name TEXT NOT NULL,
        format TEXT NOT NULL CHECK (format IN ('pdf', 'text')),
        sections TEXT NOT NULL
      )`,
    },
  ],
  down: [{ type: 'rawSQL', sql: 'DROP TABLE android_document_attachments' }],
};
