/**
 * 通用同步框架 - 数据适配器接口
 * 
 * 每种可同步的数据类型需要实现此接口，
 * 负责本地数据的读写和格式转换。
 */

import type { SyncDataType, SyncItem, SyncMetadataEntry } from './types';

/** 同步文档 - 存储到远端的数据格式 */
export type SyncDoc = Record<string, unknown> & SyncItem;

/**
 * 数据适配器接口
 * 
 * @template T 本地数据类型，必须扩展 SyncItem
 * @template D 同步文档类型，用于远端存储
 */
export interface SyncAdapter<T extends SyncItem, D extends SyncDoc = SyncDoc> {
  /** 数据类型标识 */
  readonly dataType: SyncDataType;
  
  /** 远端存储路径（相对于 basePath） */
  readonly remotePath: string;
  
  /** 数据类型显示名称 */
  readonly displayName: string;

  // ========== 本地数据操作 ==========
  
  /**
   * 获取所有本地数据
   * 包括已软删除的数据（用于同步删除状态）
   */
  getLocalItems(): Promise<T[]>;
  
  /**
   * 根据 ID 获取本地数据
   */
  getLocalItem(id: string): Promise<T | null>;
  
  /**
   * 检查本地是否存在该 ID
   */
  localItemExists(id: string): Promise<boolean>;
  
  /**
   * 创建本地数据
   */
  createLocalItem(item: T, deviceId: string): Promise<void>;
  
  /**
   * 更新本地数据
   */
  updateLocalItem(id: string, item: T, deviceId: string): Promise<void>;
  
  /**
   * 删除本地数据（软删除）
   */
  deleteLocalItem(id: string, deletedAt: number, deviceId: string): Promise<void>;

  // ========== 格式转换 ==========
  
  /**
   * 将本地格式转换为同步文档格式
   */
  toSyncDoc(item: T): D;
  
  /**
   * 将同步文档格式转换为本地格式
   */
  fromSyncDoc(doc: D): T;

  // ========== 元数据提取 ==========
  
  /**
   * 从本地数据提取元数据
   */
  extractMetadata(item: T, deviceId: string): SyncMetadataEntry;

  // ========== 同步后回调（可选） ==========
  
  /**
   * 同步完成后的回调，用于刷新 Store 等
   */
  onSyncComplete?(): Promise<void>;
}

/**
 * 适配器基类 - 提供通用实现
 */
export abstract class BaseSyncAdapter<T extends SyncItem, D extends SyncDoc = SyncDoc> 
  implements SyncAdapter<T, D> {
  
  abstract readonly dataType: SyncDataType;
  abstract readonly remotePath: string;
  abstract readonly displayName: string;
  
  abstract getLocalItems(): Promise<T[]>;
  abstract getLocalItem(id: string): Promise<T | null>;
  abstract localItemExists(id: string): Promise<boolean>;
  abstract createLocalItem(item: T, deviceId: string): Promise<void>;
  abstract updateLocalItem(id: string, item: T, deviceId: string): Promise<void>;
  abstract deleteLocalItem(id: string, deletedAt: number, deviceId: string): Promise<void>;
  abstract toSyncDoc(item: T): D;
  abstract fromSyncDoc(doc: D): T;
  
  /**
   * 默认的元数据提取实现
   */
  extractMetadata(item: T, deviceId: string): SyncMetadataEntry {
    return {
      updated_at: item.updated_at,
      deleted_at: item.deleted_at ?? null,
      device_id: item.updated_by_device_id ?? deviceId,
    };
  }
  
  /**
   * 默认的同步完成回调（空实现）
   */
  async onSyncComplete(): Promise<void> {
    // 子类可以覆盖此方法
  }
}
