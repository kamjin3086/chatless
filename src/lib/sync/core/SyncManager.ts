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
 * A metadata write is a compare-and-swap on the ETag we read. This many passes
 * is enough for a device to lose a race and still land on a fresh state; more
 * than that means something keeps changing the file and the caller must see it.
 */
const MAX_CONFLICT_ATTEMPTS = 3;

function isPreconditionFailure(error: unknown): boolean {
  return /412|precondition/i.test(String(error));
}

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

      // 获取本地数据
      const localItems = await adapter.getLocalItems();
      const localById = new Map<string, T>();
      for (const item of localItems) {
        localById.set(item.id, item);
      }

      // A metadata write is a compare-and-swap. If the ETag moved, the whole
      // pass restarts from the freshly read metadata instead of merging the
      // snapshot it just lost with: the snapshot is the older side of the
      // conflict, and letting it win rolls newer remote entries backward.
      for (let attempt = 0; attempt < MAX_CONFLICT_ATTEMPTS; attempt++) {
        const metaResult: MetadataResult = await transport.getMetadata(metaPath);
        const remoteMeta: SyncMetadataFile = metaResult.data ?? {
          version: 1,
          updated_at: Date.now(),
          items: {},
        };
        const remoteMetaEtag = metaResult.etag;

        if (!remoteMeta.items) {
          remoteMeta.items = {};
        }

        // Counters only describe the pass that lands. An attempt that loses the
        // CAS changed nothing durable (its body writes were conditional), so it
        // is not reported as progress.
        const pass = { pushed: 0, pulled: 0, skipped: 0, remoteCreated: !metaResult.data };

        try {
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
                  pass.skipped++;
                  continue;
                }

                const itemPath = `${dataPath}/${item.id}.json`;
                const doc = adapter.toSyncDoc(item) as SyncDoc;
                // Metadata can lag the body when another device crashed between
                // the two writes. Read the body and its ETag before deciding: a
                // newer body must not be overwritten by a stale metadata entry,
                // and the ETag makes the write itself conditional.
                const current = await transport.getItem<SyncDoc>(itemPath);
                if (current.data) {
                  const bodyDevice = (current.data.updated_by_device_id as string | null | undefined)
                    ?? remoteEntry?.device_id
                    ?? null;
                  const bodyMeta = {
                    updated_at: Number(current.data.updated_at) || 0,
                    device_id: bodyDevice ?? undefined,
                  };
                  if (!shouldLocalWin(localMeta, bodyMeta)) {
                    // A body with no device id and our own timestamp can only be
                    // our earlier conditional write from a pass that lost its
                    // metadata CAS. Adopt it instead of dropping our metadata.
                    const alreadyApplied = bodyMeta.updated_at === localMeta.updated_at
                      && (current.data.updated_by_device_id == null
                        || String(current.data.updated_by_device_id) === String(localMeta.device_id));
                    if (alreadyApplied) {
                      remoteMeta.items[item.id] = adapter.extractMetadata(item, deviceId);
                      pass.pushed++;
                    } else {
                      // The body is the winner. Keep its metadata so the pull
                      // phase (when enabled) can bring the local copy forward.
                      remoteMeta.items[item.id] = {
                        updated_at: bodyMeta.updated_at,
                        deleted_at: (current.data.deleted_at as number | null | undefined) ?? null,
                        device_id: bodyMeta.device_id ?? undefined,
                      };
                      pass.skipped++;
                    }
                    continue;
                  }
                }

                await transport.putItem(itemPath, doc, current.etag);
                remoteMeta.items[item.id] = adapter.extractMetadata(item, deviceId);
                pass.pushed++;
              } catch (e) {
                // A concurrent body write is a conflict for the whole pass, not
                // a per-item failure: refetch the metadata and decide again.
                if (isPreconditionFailure(e)) throw e;
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
                  pass.skipped++;
                  continue;
                }

                // 处理删除
                if (entry.deleted_at) {
                  if (local) {
                    await adapter.deleteLocalItem(id, entry.deleted_at, entry.device_id ?? deviceId);
                  }
                  pass.pulled++;
                  continue;
                }

                // 获取远端数据
                const itemResult = await transport.getItem<SyncDoc>(`${dataPath}/${id}.json`);
                if (!itemResult.data) {
                  pass.skipped++;
                  continue;
                }

                const remoteDoc = itemResult.data;
                const exists = await adapter.localItemExists(id);

                if (!exists) {
                  await adapter.createLocalItem(adapter.fromSyncDoc(remoteDoc) as T, deviceId);
                } else {
                  await adapter.updateLocalItem(id, adapter.fromSyncDoc(remoteDoc) as T, deviceId);
                }

                pass.pulled++;
              } catch (e) {
                result.errors.push(`Pull failed for ${id}: ${String(e)}`);
              }
            }
          }

          // 保存更新后的元数据，并带上刚读到的 ETag
          remoteMeta.updated_at = Date.now();
          await transport.putMetadata(metaPath, remoteMeta, remoteMetaEtag);
        } catch (e) {
          if (isPreconditionFailure(e) && attempt + 1 < MAX_CONFLICT_ATTEMPTS) {
            continue;
          }
          throw e;
        }

        result.pushed += pass.pushed;
        result.pulled += pass.pulled;
        result.skipped += pass.skipped;
        if (pass.remoteCreated) result.remoteCreated = true;
        break;
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
