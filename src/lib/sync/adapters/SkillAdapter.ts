/**
 * Skills 元数据同步适配器
 * 
 * 只同步技能的元数据（启用状态、安装时间等），
 * 不同步完整的技能文件内容。
 */

import { BaseSyncAdapter, type SyncDoc } from '../core/SyncAdapter';
import type { SyncDataType, SyncMetadataEntry, SyncItem } from '../core/types';
import { useSkillStore } from '@/store/skillStore';

/**
 * Skill 同步文档格式
 * 
 * 只包含需要跨设备同步的元数据
 */
export interface SkillSyncDoc extends SyncDoc {
  id: string;
  /** 是否启用 */
  enabled: boolean;
  /** 安装时间 */
  installedAt?: number;
  /** 更新时间 */
  updated_at: number;
  /** 软删除时间 */
  deleted_at?: number | null;
  /** 更新设备 ID */
  updated_by_device_id?: string | null;
}

/**
 * Skill 本地数据格式（扩展 SyncItem）
 */
export interface SkillSyncItem extends SyncItem {
  id: string;
  enabled: boolean;
  installedAt?: number;
  updated_at: number;
  deleted_at?: number | null;
  updated_by_device_id?: string | null;
}

/**
 * Skills 元数据同步适配器实现
 * 
 * 注意：此适配器只同步技能的配置元数据，
 * 而非技能本身的文件和内容。
 */
export class SkillAdapter extends BaseSyncAdapter<SkillSyncItem, SkillSyncDoc> {
  readonly dataType: SyncDataType = 'skills';
  readonly remotePath = 'skills/data';
  readonly displayName = '技能配置';

  /**
   * 获取所有本地 Skill 元数据
   */
  async getLocalItems(): Promise<SkillSyncItem[]> {
    const store = useSkillStore.getState();
    const skills = store.skills;
    
    return skills.map(skill => ({
      id: skill.id,
      enabled: skill.enabled,
      installedAt: skill.installedAt,
      updated_at: skill.installedAt || Date.now(),
      deleted_at: null,
      updated_by_device_id: null,
    }));
  }

  /**
   * 根据 ID 获取本地 Skill 元数据
   */
  async getLocalItem(id: string): Promise<SkillSyncItem | null> {
    const store = useSkillStore.getState();
    const skill = store.skills.find(s => s.id === id);
    
    if (!skill) return null;
    
    return {
      id: skill.id,
      enabled: skill.enabled,
      installedAt: skill.installedAt,
      updated_at: skill.installedAt || Date.now(),
      deleted_at: null,
      updated_by_device_id: null,
    };
  }

  /**
   * 检查本地是否存在该 Skill
   */
  async localItemExists(id: string): Promise<boolean> {
    const store = useSkillStore.getState();
    return store.skills.some(s => s.id === id);
  }

  /**
   * 创建本地 Skill 元数据
   * 
   * 注意：这里只更新 Store 中的元数据，
   * 实际的技能文件需要单独安装。
   */
  async createLocalItem(item: SkillSyncItem, deviceId: string): Promise<void> {
    const store = useSkillStore.getState();
    const existingSkill = store.skills.find(s => s.id === item.id);
    
    if (existingSkill) {
      // 如果技能已存在，更新其元数据
      store.updateSkill(item.id, {
        enabled: item.enabled,
        installedAt: item.installedAt,
      });
    }
    // 如果技能不存在，不做任何操作
    // 技能的安装需要通过技能管理器单独进行
  }

  /**
   * 更新本地 Skill 元数据
   */
  async updateLocalItem(id: string, item: SkillSyncItem, deviceId: string): Promise<void> {
    const store = useSkillStore.getState();
    const existingSkill = store.skills.find(s => s.id === id);
    
    if (existingSkill) {
      store.updateSkill(id, {
        enabled: item.enabled,
        installedAt: item.installedAt,
      });
    }
  }

  /**
   * 删除本地 Skill 元数据
   * 
   * 注意：这里不实际删除技能文件，
   * 只是将其标记为禁用状态。
   */
  async deleteLocalItem(id: string, deletedAt: number, deviceId: string): Promise<void> {
    const store = useSkillStore.getState();
    const existingSkill = store.skills.find(s => s.id === id);
    
    if (existingSkill) {
      store.updateSkill(id, {
        enabled: false,
      });
    }
  }

  /**
   * 将本地格式转换为同步文档格式
   */
  toSyncDoc(item: SkillSyncItem): SkillSyncDoc {
    return {
      id: item.id,
      enabled: item.enabled,
      installedAt: item.installedAt,
      updated_at: item.updated_at,
      deleted_at: item.deleted_at ?? null,
      updated_by_device_id: item.updated_by_device_id ?? null,
    };
  }

  /**
   * 将同步文档格式转换为本地格式
   */
  fromSyncDoc(doc: SkillSyncDoc): SkillSyncItem {
    return {
      id: doc.id,
      enabled: doc.enabled,
      installedAt: doc.installedAt,
      updated_at: doc.updated_at,
      deleted_at: doc.deleted_at ?? null,
      updated_by_device_id: doc.updated_by_device_id ?? null,
    };
  }

  /**
   * 提取元数据
   */
  extractMetadata(item: SkillSyncItem, deviceId: string): SyncMetadataEntry {
    return {
      updated_at: item.updated_at,
      deleted_at: item.deleted_at ?? null,
      device_id: item.updated_by_device_id ?? deviceId,
    };
  }

  /**
   * 同步完成后不需要额外操作
   * Store 的持久化由 Zustand persist 中间件处理
   */
  async onSyncComplete(): Promise<void> {
    // Skills store 使用 persist 中间件自动保存
  }
}

/**
 * 创建 Skill 适配器实例
 */
export function createSkillAdapter(): SkillAdapter {
  return new SkillAdapter();
}
