import { BaseRepository } from './BaseRepository';
import type { DatabaseManager } from '../core/DatabaseManager';

export interface DbPromptItem {
  id: string;
  name: string;
  description?: string;
  content: string;
  tags?: string; // JSON array
  languages?: string; // JSON array
  model_hints?: string; // JSON array
  variables?: string; // JSON array
  shortcuts?: string; // JSON array
  favorite?: number; // 0/1
  created_at: number;
  updated_at: number;
  external_id?: string | null;
  stats?: string; // { uses, lastUsedAt }
  deleted_at?: number | null;
  updated_by_device_id?: string | null;
}

export class PromptRepository extends BaseRepository<DbPromptItem> {
  protected tableName = 'prompts';
  protected primaryKey = 'id';

  constructor(dbManager: DatabaseManager) {
    super(dbManager as any);
  }
}
