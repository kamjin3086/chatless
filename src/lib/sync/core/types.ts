/**
 * 通用同步框架 - 核心类型定义
 */

/** 支持的同步数据类型 */
export type SyncDataType = 'prompts' | 'skills' | 'providers' | 'settings';

/** 同步数据类型的显示信息 */
export const SYNC_DATA_TYPE_INFO: Record<SyncDataType, { label: string; description: string }> = {
  prompts: {
    label: '提示词',
    description: '自定义提示词模板',
  },
  skills: {
    label: '技能配置',
    description: '已安装技能的启用状态',
  },
  providers: {
    label: 'Provider 配置',
    description: '模型服务商的显示和偏好设置（不含密钥）',
  },
  settings: {
    label: '用户设置',
    description: '主题、字体、界面偏好等',
  },
};

/** 同步项通用接口 - 所有可同步数据必须实现 */
export interface SyncItem {
  /** 唯一标识 */
  id: string;
  /** 更新时间戳 */
  updated_at: number;
  /** 软删除时间戳 */
  deleted_at?: number | null;
  /** 更新设备 ID */
  updated_by_device_id?: string | null;
}

/** 同步元数据条目 - 用于 metadata.json */
export interface SyncMetadataEntry {
  /** 更新时间戳 */
  updated_at: number;
  /** 软删除时间戳 */
  deleted_at?: number | null;
  /** 设备 ID */
  device_id?: string;
}

/** 同步元数据文件结构 */
export interface SyncMetadataFile {
  /** 版本号 */
  version: 1;
  /** 文件更新时间 */
  updated_at: number;
  /** 各项元数据 */
  items: Record<string, SyncMetadataEntry>;
}

/** 单个数据类型的同步结果 */
export interface SyncResult {
  /** 数据类型 */
  dataType: SyncDataType;
  /** 推送数量 */
  pushed: number;
  /** 拉取数量 */
  pulled: number;
  /** 跳过数量 */
  skipped: number;
  /** 错误信息列表 */
  errors: string[];
  /** 是否首次创建远端 */
  remoteCreated?: boolean;
}

/** 完整同步结果（所有数据类型） */
export interface FullSyncResult {
  /** 各数据类型的结果 */
  results: SyncResult[];
  /** 总推送数 */
  totalPushed: number;
  /** 总拉取数 */
  totalPulled: number;
  /** 总跳过数 */
  totalSkipped: number;
  /** 是否有错误 */
  hasErrors: boolean;
  /** 同步时间戳 */
  timestamp: number;
}

/** 同步方向 */
export type SyncDirection = 'both' | 'push' | 'pull';

/** 同步配置 */
export interface SyncConfig {
  /** 是否启用同步 */
  enabled: boolean;
  /** 是否启用自动同步 */
  autoSync: boolean;
  /** 启用同步的数据类型 */
  enabledDataTypes: SyncDataType[];
}

/** 连接状态 */
export type ConnectionStatus = 'unknown' | 'checking' | 'connected' | 'error';

/** 同步状态 */
export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

/** 冲突解决元数据 */
export interface ConflictMetadata {
  updated_at: number;
  device_id?: string | null;
}
