/**
 * 通用同步框架 - 核心模块导出
 */

// 类型定义
export type {
  SyncDataType,
  SyncItem,
  SyncMetadataEntry,
  SyncMetadataFile,
  SyncResult,
  FullSyncResult,
  SyncDirection,
  SyncConfig,
  ConnectionStatus,
  SyncStatus,
  ConflictMetadata,
} from './types';

export { SYNC_DATA_TYPE_INFO } from './types';

// 适配器接口
export type { SyncDoc, SyncAdapter } from './SyncAdapter';
export { BaseSyncAdapter } from './SyncAdapter';

// 传输层接口
export type {
  SyncTransport,
  TransportConfig,
  WebDAVTransportConfig,
  TransportFactory,
  MetadataResult,
  ItemResult,
} from './SyncTransport';

// 冲突解决
export { shouldLocalWin, shouldRemoteWin, getConflictWinner } from './ConflictResolver';

// 同步管理器
export type { SyncManagerConfig } from './SyncManager';
export { SyncManager, createSyncManager } from './SyncManager';
