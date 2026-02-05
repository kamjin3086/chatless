/**
 * Provider 配置同步适配器
 * 
 * 同步模型服务商的显示和偏好设置，
 * 注意：不同步 API 密钥等敏感信息。
 */

import { BaseSyncAdapter, type SyncDoc } from '../core/SyncAdapter';
import type { SyncDataType, SyncMetadataEntry, SyncItem } from '../core/types';
import { providerRepository } from '@/lib/provider/ProviderRepository';
import type { ProviderEntity } from '@/lib/provider/types';
import { ProviderStatus } from '@/lib/provider/types';

/**
 * Provider 同步文档格式
 * 
 * 只包含可以跨设备同步的非敏感配置
 * 不包含：apiKey、status、lastChecked、lastReason、lastMessage
 */
export interface ProviderSyncDoc extends SyncDoc {
  id: string;
  /** Provider 唯一标识名 */
  name: string;
  /** 展示名称 */
  displayName?: string;
  /** 服务 URL */
  url: string;
  /** 是否需要 API Key */
  requiresKey: boolean;
  /** 是否为用户新增 */
  isUserAdded?: boolean;
  /** 是否可见 */
  isVisible?: boolean;
  /** 策略类型 */
  strategy?: string;
  /** 头像种子 */
  avatarSeed?: string;
  /** 偏好设置（不含敏感信息） */
  preferences?: {
    useBrowserRequest?: boolean;
  };
  /** 更新时间 */
  updated_at: number;
  /** 软删除时间 */
  deleted_at?: number | null;
  /** 更新设备 ID */
  updated_by_device_id?: string | null;
}

/**
 * Provider 本地数据格式（扩展 SyncItem）
 */
export interface ProviderSyncItem extends SyncItem {
  id: string;
  name: string;
  displayName?: string;
  url: string;
  requiresKey: boolean;
  isUserAdded?: boolean;
  isVisible?: boolean;
  strategy?: string;
  avatarSeed?: string;
  preferences?: {
    useBrowserRequest?: boolean;
  };
  updated_at: number;
  deleted_at?: number | null;
  updated_by_device_id?: string | null;
}

/**
 * Provider 配置同步适配器实现
 * 
 * 注意：此适配器只同步 Provider 的配置元数据，
 * 不同步敏感信息如 API 密钥。
 */
export class ProviderAdapter extends BaseSyncAdapter<ProviderSyncItem, ProviderSyncDoc> {
  readonly dataType: SyncDataType = 'providers';
  readonly remotePath = 'providers/data';
  readonly displayName = 'Provider 配置';

  /**
   * 将 ProviderEntity 转换为 ProviderSyncItem
   */
  private entityToSyncItem(entity: ProviderEntity): ProviderSyncItem {
    return {
      id: entity.name, // 使用 name 作为 ID
      name: entity.name,
      displayName: entity.displayName,
      url: entity.url,
      requiresKey: entity.requiresKey,
      isUserAdded: entity.isUserAdded,
      isVisible: entity.isVisible,
      strategy: entity.strategy,
      avatarSeed: entity.avatarSeed,
      preferences: entity.preferences ? {
        useBrowserRequest: entity.preferences.useBrowserRequest,
      } : undefined,
      updated_at: entity.lastChecked || Date.now(),
      deleted_at: null,
      updated_by_device_id: null,
    };
  }

  /**
   * 获取所有本地 Provider 配置
   */
  async getLocalItems(): Promise<ProviderSyncItem[]> {
    const providers = await providerRepository.getAll();
    return providers.map(p => this.entityToSyncItem(p));
  }

  /**
   * 根据 ID 获取本地 Provider 配置
   */
  async getLocalItem(id: string): Promise<ProviderSyncItem | null> {
    const providers = await providerRepository.getAll();
    const provider = providers.find(p => p.name === id);
    
    if (!provider) return null;
    
    return this.entityToSyncItem(provider);
  }

  /**
   * 检查本地是否存在该 Provider
   */
  async localItemExists(id: string): Promise<boolean> {
    const providers = await providerRepository.getAll();
    return providers.some(p => p.name === id);
  }

  /**
   * 创建本地 Provider 配置
   */
  async createLocalItem(item: ProviderSyncItem, deviceId: string): Promise<void> {
    const entity: ProviderEntity = {
      name: item.name,
      displayName: item.displayName,
      url: item.url,
      requiresKey: item.requiresKey,
      status: ProviderStatus.UNKNOWN,
      lastChecked: item.updated_at,
      isUserAdded: item.isUserAdded ?? true,
      isVisible: item.isVisible ?? true,
      strategy: item.strategy,
      avatarSeed: item.avatarSeed,
      preferences: item.preferences,
    };
    
    await providerRepository.upsert(entity);
  }

  /**
   * 更新本地 Provider 配置
   */
  async updateLocalItem(id: string, item: ProviderSyncItem, deviceId: string): Promise<void> {
    const providers = await providerRepository.getAll();
    const existingProvider = providers.find(p => p.name === id);
    
    if (!existingProvider) {
      // 如果不存在，创建新的
      await this.createLocalItem(item, deviceId);
      return;
    }
    
    // 更新配置，保留本地的敏感信息
    await providerRepository.update({
      name: id,
      displayName: item.displayName,
      url: item.url,
      requiresKey: item.requiresKey,
      isUserAdded: item.isUserAdded,
      isVisible: item.isVisible,
      strategy: item.strategy,
      avatarSeed: item.avatarSeed,
      preferences: item.preferences,
    });
  }

  /**
   * 删除本地 Provider 配置
   * 
   * 注意：这里将其标记为不可见而非真正删除
   */
  async deleteLocalItem(id: string, deletedAt: number, deviceId: string): Promise<void> {
    await providerRepository.setVisibility(id, false);
  }

  /**
   * 将本地格式转换为同步文档格式
   */
  toSyncDoc(item: ProviderSyncItem): ProviderSyncDoc {
    return {
      id: item.id,
      name: item.name,
      displayName: item.displayName,
      url: item.url,
      requiresKey: item.requiresKey,
      isUserAdded: item.isUserAdded,
      isVisible: item.isVisible,
      strategy: item.strategy,
      avatarSeed: item.avatarSeed,
      preferences: item.preferences,
      updated_at: item.updated_at,
      deleted_at: item.deleted_at ?? null,
      updated_by_device_id: item.updated_by_device_id ?? null,
    };
  }

  /**
   * 将同步文档格式转换为本地格式
   */
  fromSyncDoc(doc: ProviderSyncDoc): ProviderSyncItem {
    return {
      id: doc.id,
      name: doc.name,
      displayName: doc.displayName,
      url: doc.url,
      requiresKey: doc.requiresKey,
      isUserAdded: doc.isUserAdded,
      isVisible: doc.isVisible,
      strategy: doc.strategy,
      avatarSeed: doc.avatarSeed,
      preferences: doc.preferences,
      updated_at: doc.updated_at,
      deleted_at: doc.deleted_at ?? null,
      updated_by_device_id: doc.updated_by_device_id ?? null,
    };
  }

  /**
   * 提取元数据
   */
  extractMetadata(item: ProviderSyncItem, deviceId: string): SyncMetadataEntry {
    return {
      updated_at: item.updated_at,
      deleted_at: item.deleted_at ?? null,
      device_id: item.updated_by_device_id ?? deviceId,
    };
  }

  /**
   * 同步完成后不需要额外操作
   * Repository 的缓存机制会自动触发订阅通知
   */
  async onSyncComplete(): Promise<void> {
    // Provider Repository 使用 CacheManager 自动广播变更
  }
}

/**
 * 创建 Provider 适配器实例
 */
export function createProviderAdapter(): ProviderAdapter {
  return new ProviderAdapter();
}
