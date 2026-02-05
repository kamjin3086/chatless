/**
 * 通用同步框架 - 同步管理器
 * 
 * 核心同步逻辑实现，协调适配器和传输层完成数据同步
 */

import type { SyncTransport, MetadataResult } from './SyncTransport';
import type { SyncAdapter, SyncDoc } from './SyncAdapter';
import type { 
  SyncDataType, 
  SyncDirection, 
  SyncMetadataEntry, 
  SyncMetadataFile, 
  SyncResult,
  FullSyncResult,
  SyncItem 
} from './types';
import { shouldLocalWin, shouldRemoteWin } from './ConflictResolver';

/**
 * 同步管理器配置
 */
export interface SyncManagerConfig {
  /** 设备 ID */
  deviceId: string;
  /** 传输层实例 */
  transport: SyncTransport;
  /** 各数据类型的适配器 */
  adapters: Map<SyncDataType, SyncAdapter<SyncItem>>;
}

/**
 * 同步管理器
 * 
 * 负责协调不同数据类型的同步操作
 */
export class SyncManager {
  private config: SyncManagerConfig;
  private isSyncing = false;

  constructor(config: SyncManagerConfig) {
    this.config = config;
  }

  /**
   * 检查连接状态
   */
  async checkConnection(): Promise<boolean> {
    return this.config.transport.checkConnection();
  }

  /**
   * 同步指定数据类型
   */
  async syncDataType(
    dataType: SyncDataType,
    direction: SyncDirection = 'both'
  ): Promise<SyncResult> {
    const adapter = this.config.adapters.get(dataType);
    if (!adapter) {
      return {
        dataType,
        pushed: 0,
        pulled: 0,
        skipped: 0,
        errors: [`No adapter registered for data type: ${dataType}`],
      };
    }

    return this.syncWithAdapter(adapter, direction);
  }

  /**
   * 同步所有启用的数据类型
   */
  async syncAll(
    enabledTypes: SyncDataType[],
    direction: SyncDirection = 'both'
  ): Promise<FullSyncResult> {
    if (this.isSyncing) {
      return {
        results: [],
        totalPushed: 0,
        totalPulled: 0,
        totalSkipped: 0,
        hasErrors: true,
        timestamp: Date.now(),
      };
    }

    this.isSyncing = true;
    const results: SyncResult[] = [];
    let totalPushed = 0;
    let totalPulled = 0;
    let totalSkipped = 0;
    let hasErrors = false;

    try {
      for (const dataType of enabledTypes) {
        const result = await this.syncDataType(dataType, direction);
        results.push(result);
        totalPushed += result.pushed;
        totalPulled += result.pulled;
        totalSkipped += result.skipped;
        if (result.errors.length > 0) {
          hasErrors = true;
        }
      }
    } finally {
      this.isSyncing = false;
    }

    return {
      results,
      totalPushed,
      totalPulled,
      totalSkipped,
      hasErrors,
      timestamp: Date.now(),
    };
  }

  /**
   * 使用适配器执行同步
   */
  private async syncWithAdapter<T extends SyncItem>(
    adapter: SyncAdapter<T>,
    direction: SyncDirection
  ): Promise<SyncResult> {
    const result: SyncResult = {
      dataType: adapter.dataType,
      pushed: 0,
      pulled: 0,
      skipped: 0,
      errors: [],
    };

    const { deviceId, transport } = this.config;
    const dataPath = adapter.remotePath;
    const metaPath = `${dataPath}/metadata.json`;

    try {
      // 确保远端目录存在
      await transport.ensureDirectory(dataPath);

      // 获取远端元数据
      const metaResult: MetadataResult = await transport.getMetadata(metaPath);
      let remoteMeta: SyncMetadataFile = metaResult.data ?? {
        version: 1,
        updated_at: Date.now(),
        items: {},
      };
      const remoteMetaEtag = metaResult.etag;

      if (!remoteMeta.items) {
        remoteMeta.items = {};
      }

      if (!metaResult.data) {
        result.remoteCreated = true;
      }

      // 获取本地数据
      const localItems = await adapter.getLocalItems();
      const localById = new Map<string, T>();
      for (const item of localItems) {
        localById.set(item.id, item);
      }

      // Push: 本地 -> 远端
      if (direction === 'both' || direction === 'push') {
        for (const item of localItems) {
          try {
            const localMeta = {
              updated_at: item.updated_at,
              device_id: item.updated_by_device_id ?? deviceId,
            };
            const remoteEntry = remoteMeta.items[item.id];

            if (!shouldLocalWin(localMeta, remoteEntry)) {
              result.skipped++;
              continue;
            }

            // 转换并推送
            const doc = adapter.toSyncDoc(item) as SyncDoc;
            await transport.putItem(`${dataPath}/${item.id}.json`, doc);

            // 更新元数据
            remoteMeta.items[item.id] = adapter.extractMetadata(item, deviceId);
            result.pushed++;
          } catch (e) {
            result.errors.push(`Push failed for ${item.id}: ${String(e)}`);
          }
        }
      }

      // Pull: 远端 -> 本地
      if (direction === 'both' || direction === 'pull') {
        for (const [id, entry] of Object.entries(remoteMeta.items)) {
          try {
            const local = localById.get(id);
            const localMeta = local
              ? { updated_at: local.updated_at, device_id: local.updated_by_device_id ?? null }
              : null;

            if (!shouldRemoteWin(entry, localMeta)) {
              result.skipped++;
              continue;
            }

            // 处理删除
            if (entry.deleted_at) {
              if (local) {
                await adapter.deleteLocalItem(id, entry.deleted_at, entry.device_id ?? deviceId);
              }
              result.pulled++;
              continue;
            }

            // 获取远端数据
            const itemResult = await transport.getItem<SyncDoc>(`${dataPath}/${id}.json`);
            if (!itemResult.data) {
              result.skipped++;
              continue;
            }

            const remoteDoc = itemResult.data;
            const exists = await adapter.localItemExists(id);

            if (!exists) {
              await adapter.createLocalItem(adapter.fromSyncDoc(remoteDoc) as T, deviceId);
            } else {
              await adapter.updateLocalItem(id, adapter.fromSyncDoc(remoteDoc) as T, deviceId);
            }

            result.pulled++;
          } catch (e) {
            result.errors.push(`Pull failed for ${id}: ${String(e)}`);
          }
        }
      }

      // 保存更新后的元数据
      remoteMeta.updated_at = Date.now();
      try {
        await transport.putMetadata(metaPath, remoteMeta, remoteMetaEtag);
      } catch (e) {
        // 处理 ETag 冲突 - 重新获取并合并
        const msg = String(e);
        if (/412|precondition/i.test(msg)) {
          const latest = await transport.getMetadata(metaPath);
          if (latest.data?.items) {
            const merged: SyncMetadataFile = {
              version: 1,
              updated_at: Date.now(),
              items: { ...latest.data.items, ...remoteMeta.items },
            };
            await transport.putMetadata(metaPath, merged);
          }
        } else {
          throw e;
        }
      }

      // 同步完成回调
      await adapter.onSyncComplete?.();
    } catch (e) {
      result.errors.push(`Sync failed: ${String(e)}`);
    }

    return result;
  }

  /**
   * 注册适配器
   */
  registerAdapter<T extends SyncItem>(adapter: SyncAdapter<T>): void {
    this.config.adapters.set(adapter.dataType, adapter as SyncAdapter<SyncItem>);
  }

  /**
   * 获取适配器
   */
  getAdapter<T extends SyncItem>(dataType: SyncDataType): SyncAdapter<T> | undefined {
    return this.config.adapters.get(dataType) as SyncAdapter<T> | undefined;
  }

  /**
   * 获取所有已注册的数据类型
   */
  getRegisteredDataTypes(): SyncDataType[] {
    return Array.from(this.config.adapters.keys());
  }

  /**
   * 检查是否正在同步
   */
  get syncing(): boolean {
    return this.isSyncing;
  }
}

/**
 * 创建 SyncManager 实例
 */
export function createSyncManager(
  deviceId: string,
  transport: SyncTransport
): SyncManager {
  return new SyncManager({
    deviceId,
    transport,
    adapters: new Map(),
  });
}
