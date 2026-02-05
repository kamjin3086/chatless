/**
 * Prompt 同步适配器
 * 
 * 将现有的 Prompt 数据同步逻辑适配为通用同步框架
 */

import { BaseSyncAdapter, type SyncDoc } from '../core/SyncAdapter';
import type { SyncDataType, SyncMetadataEntry, SyncItem } from '../core/types';
import { DatabaseService } from '@/lib/database/services/DatabaseService';
import type { DbPromptItem } from '@/lib/database/repositories/PromptRepository';
import { usePromptStore } from '@/store/promptStore';

/**
 * Prompt 同步文档格式
 */
export interface PromptSyncDoc extends SyncDoc {
  id: string;
  name: string;
  description?: string;
  content: string;
  tags?: string[];
  languages?: string[];
  modelHints?: string[];
  variables?: any[];
  shortcuts?: string[];
  favorite?: boolean;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  updated_by_device_id?: string | null;
  external_id?: string | null;
  stats?: {
    uses: number;
    lastUsedAt?: number;
  };
}

/**
 * Prompt 本地数据格式（扩展 SyncItem）
 */
export interface PromptSyncItem extends SyncItem {
  id: string;
  name: string;
  description?: string;
  content: string;
  tags?: string;
  languages?: string;
  model_hints?: string;
  variables?: string;
  shortcuts?: string;
  favorite?: number;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  updated_by_device_id?: string | null;
  external_id?: string | null;
  stats?: string;
}

// ============ 辅助函数 ============

function parseJsonArray(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return [];
  }
}

function parseJsonObject(value: any): any {
  if (!value) return undefined;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return undefined;
  }
}

/**
 * Prompt 同步适配器实现
 */
export class PromptAdapter extends BaseSyncAdapter<PromptSyncItem, PromptSyncDoc> {
  readonly dataType: SyncDataType = 'prompts';
  readonly remotePath = 'prompts/data';
  readonly displayName = '提示词';

  /**
   * 获取所有本地 Prompt
   */
  async getLocalItems(): Promise<PromptSyncItem[]> {
    const db = DatabaseService.getInstance();
    const repo = db.getPromptRepository();
    const rows = await repo.findAll();
    return rows as PromptSyncItem[];
  }

  /**
   * 根据 ID 获取本地 Prompt
   */
  async getLocalItem(id: string): Promise<PromptSyncItem | null> {
    const db = DatabaseService.getInstance();
    const repo = db.getPromptRepository();
    const row = await repo.findById(id);
    return row as PromptSyncItem | null;
  }

  /**
   * 检查本地是否存在该 Prompt
   */
  async localItemExists(id: string): Promise<boolean> {
    const db = DatabaseService.getInstance();
    const repo = db.getPromptRepository();
    return repo.exists(id);
  }

  /**
   * 创建本地 Prompt
   */
  async createLocalItem(item: PromptSyncItem, deviceId: string): Promise<void> {
    const db = DatabaseService.getInstance();
    const repo = db.getPromptRepository();
    
    const dbItem: DbPromptItem = {
      id: item.id,
      name: item.name,
      description: item.description || '',
      content: item.content,
      tags: item.tags || '[]',
      languages: item.languages || '[]',
      model_hints: item.model_hints || '[]',
      variables: item.variables || '[]',
      shortcuts: item.shortcuts || '[]',
      favorite: item.favorite ?? 0,
      created_at: item.created_at,
      updated_at: item.updated_at,
      external_id: item.external_id ?? null,
      stats: item.stats || '{"uses":0}',
      deleted_at: item.deleted_at ?? null,
      updated_by_device_id: item.updated_by_device_id ?? deviceId,
    };
    
    await repo.create(dbItem as any);
  }

  /**
   * 更新本地 Prompt
   */
  async updateLocalItem(id: string, item: PromptSyncItem, deviceId: string): Promise<void> {
    const db = DatabaseService.getInstance();
    const repo = db.getPromptRepository();
    
    const prev = await repo.findById(id);
    
    await repo.update(id, {
      name: item.name,
      description: item.description || '',
      content: item.content,
      tags: item.tags || '[]',
      languages: item.languages || '[]',
      model_hints: item.model_hints || '[]',
      variables: item.variables || '[]',
      shortcuts: item.shortcuts || '[]',
      favorite: item.favorite ?? 0,
      updated_at: item.updated_at,
      created_at: prev?.created_at ?? item.created_at,
      external_id: item.external_id || null,
      stats: item.stats || '{"uses":0}',
      deleted_at: item.deleted_at ?? null,
      updated_by_device_id: item.updated_by_device_id ?? deviceId,
    } as any);
  }

  /**
   * 删除本地 Prompt（软删除）
   */
  async deleteLocalItem(id: string, deletedAt: number, deviceId: string): Promise<void> {
    const db = DatabaseService.getInstance();
    const repo = db.getPromptRepository();
    
    await repo.update(id, {
      deleted_at: deletedAt,
      updated_at: deletedAt,
      updated_by_device_id: deviceId,
    } as any);
  }

  /**
   * 将本地格式转换为同步文档格式
   */
  toSyncDoc(item: PromptSyncItem): PromptSyncDoc {
    return {
      id: item.id,
      name: item.name,
      description: item.description || '',
      content: item.content,
      tags: parseJsonArray(item.tags),
      languages: parseJsonArray(item.languages),
      modelHints: parseJsonArray(item.model_hints),
      variables: parseJsonArray(item.variables),
      shortcuts: parseJsonArray(item.shortcuts),
      favorite: !!item.favorite,
      created_at: item.created_at,
      updated_at: item.updated_at,
      deleted_at: item.deleted_at ?? null,
      updated_by_device_id: item.updated_by_device_id ?? null,
      external_id: item.external_id ?? null,
      stats: parseJsonObject(item.stats),
    };
  }

  /**
   * 将同步文档格式转换为本地格式
   */
  fromSyncDoc(doc: PromptSyncDoc): PromptSyncItem {
    return {
      id: doc.id,
      name: doc.name,
      description: doc.description || '',
      content: doc.content,
      tags: JSON.stringify(doc.tags || []),
      languages: JSON.stringify(doc.languages || []),
      model_hints: JSON.stringify(doc.modelHints || []),
      variables: JSON.stringify(doc.variables || []),
      shortcuts: JSON.stringify(doc.shortcuts || []),
      favorite: doc.favorite ? 1 : 0,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
      external_id: doc.external_id || null,
      stats: JSON.stringify(doc.stats || { uses: 0 }),
      deleted_at: doc.deleted_at ?? null,
      updated_by_device_id: doc.updated_by_device_id ?? null,
    };
  }

  /**
   * 提取元数据
   */
  extractMetadata(item: PromptSyncItem, deviceId: string): SyncMetadataEntry {
    return {
      updated_at: item.updated_at,
      deleted_at: item.deleted_at ?? null,
      device_id: item.updated_by_device_id ?? deviceId,
    };
  }

  /**
   * 同步完成后刷新 Store
   */
  async onSyncComplete(): Promise<void> {
    // 刷新 promptStore
    try {
      const promptStore = usePromptStore.getState();
      await promptStore.loadFromDatabase();
    } catch {
      // 忽略错误，可能是 Store 未初始化
    }
  }
}

/**
 * 创建 Prompt 适配器实例
 */
export function createPromptAdapter(): PromptAdapter {
  return new PromptAdapter();
}
