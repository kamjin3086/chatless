# 通用同步框架架构文档

> 本文档描述了 Chatless 应用中的通用同步框架设计与实现，用于多设备间数据同步。

## 目录

- [架构概览](#架构概览)
- [核心概念](#核心概念)
- [模块结构](#模块结构)
- [数据类型与适配器](#数据类型与适配器)
- [冲突解决策略](#冲突解决策略)
- [扩展指南](#扩展指南)
- [API 参考](#api-参考)

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        WebDavSyncStore                          │
│  (Zustand 状态管理 - 配置、状态、performSync 入口)               │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                         SyncManager                             │
│  (协调器 - 管理 adapters，执行同步逻辑，处理冲突)                 │
└───────────────┬───────────────────────────────┬─────────────────┘
                │                               │
                ▼                               ▼
┌───────────────────────────┐   ┌───────────────────────────────┐
│      SyncTransport        │   │        SyncAdapter[]          │
│   (传输层抽象接口)          │   │     (数据类型适配器接口)        │
│                           │   │                               │
│ ┌───────────────────────┐ │   │ ┌───────────────────────────┐ │
│ │   WebDAVTransport     │ │   │ │     PromptAdapter         │ │
│ │   (WebDAV 实现)        │ │   │ │     SkillAdapter          │ │
│ │   [可扩展 S3, Local]   │ │   │ │     ProviderAdapter       │ │
│ └───────────────────────┘ │   │ │     SettingsAdapter        │ │
└───────────────────────────┘   │ └───────────────────────────┘ │
                                └───────────────────────────────┘
```

### 设计原则

1. **关注点分离**: 传输层、适配层、协调层各司其职
2. **可扩展性**: 新增数据类型或后端只需实现对应接口
3. **确定性冲突解决**: 基于时间戳和设备ID的确定性规则
4. **敏感数据保护**: API Key 等敏感信息不参与同步

---

## 核心概念

### SyncDataType

定义可同步的数据类型枚举：

```typescript
type SyncDataType = 'prompts' | 'skills' | 'providers' | 'settings';
```

### SyncItem

所有可同步数据的基础接口：

```typescript
interface SyncItem {
  id: string;                          // 唯一标识
  updated_at: number;                  // 更新时间戳（毫秒）
  deleted_at?: number | null;          // 软删除时间戳
  updated_by_device_id?: string | null; // 最后更新的设备ID
}
```

### SyncDoc

远端存储的数据格式，继承自 SyncItem：

```typescript
interface SyncDoc extends SyncItem {
  id: string;
  updated_at: number;
  deleted_at?: number | null;
  updated_by_device_id?: string | null;
}
```

### SyncMetadataFile

元数据文件结构，用于跟踪所有数据项的同步状态：

```typescript
interface SyncMetadataFile {
  version: number;                              // 元数据版本
  updated_at: number;                           // 最后更新时间
  items: Record<string, SyncMetadataEntry>;     // 数据项元信息映射
}

interface SyncMetadataEntry {
  updated_at: number;
  deleted_at?: number | null;
  device_id?: string | null;
}
```

### SyncDirection

同步方向：

```typescript
type SyncDirection = 'push' | 'pull' | 'both';
```

---

## 模块结构

```
src/lib/sync/
├── core/                          # 核心模块
│   ├── types.ts                   # 类型定义
│   ├── SyncAdapter.ts             # 适配器接口和基类
│   ├── SyncTransport.ts           # 传输层接口
│   ├── SyncManager.ts             # 同步协调器
│   ├── ConflictResolver.ts        # 冲突解决器
│   └── index.ts                   # 核心模块导出
│
├── adapters/                      # 数据类型适配器
│   ├── PromptAdapter.ts           # 提示词适配器
│   ├── SkillAdapter.ts            # 技能适配器
│   ├── ProviderAdapter.ts         # Provider 适配器
│   ├── SettingsAdapter.ts         # 设置适配器
│   └── index.ts                   # 适配器导出
│
├── transports/                    # 传输层实现
│   ├── WebDAVTransport.ts         # WebDAV 传输层
│   └── index.ts                   # 传输层导出
│
├── prompts/                       # 提示词同步相关（历史模块）
│   ├── autoSync.ts                # 自动同步触发
│   └── webdavPromptSync.ts        # 旧版提示词同步（待废弃）
│
├── webdav/                        # WebDAV 客户端
│   └── WebDavClient.ts            # 底层 WebDAV 操作
│
├── deviceId.ts                    # 设备ID管理
└── index.ts                       # 主入口导出
```

---

## 数据类型与适配器

### 1. PromptAdapter - 提示词同步

**文件**: `src/lib/sync/adapters/PromptAdapter.ts`

**同步范围**: 完整的提示词内容

**数据源**: SQLite 数据库 (`PromptRepository`)

**特点**:
- 完整同步所有字段
- 通过 `loadFromDatabase()` 刷新本地 Store

```typescript
interface PromptSyncDoc extends SyncDoc {
  title: string;
  content: string;
  description?: string;
  tags?: string[];
  is_favorite?: boolean;
  variables?: PromptVariable[];
  // ... 其他字段
}
```

### 2. SkillAdapter - 技能同步

**文件**: `src/lib/sync/adapters/SkillAdapter.ts`

**同步范围**: 仅元数据（启用状态、安装时间）

**数据源**: Zustand Store (`useSkillStore`)

**特点**:
- 不同步技能文件本身
- 仅同步配置状态

```typescript
interface SkillSyncDoc extends SyncDoc {
  id: string;           // 技能 ID
  enabled: boolean;     // 是否启用
  installedAt?: number; // 安装时间
}
```

### 3. ProviderAdapter - Provider 配置同步

**文件**: `src/lib/sync/adapters/ProviderAdapter.ts`

**同步范围**: 非敏感配置信息

**数据源**: SQLite 数据库 (`providerRepository`)

**排除项**:
- `apiKey` - API 密钥
- `status` - 连接状态
- `lastChecked` - 最后检查时间
- `lastReason` / `lastMessage` - 错误信息

```typescript
interface ProviderSyncDoc extends SyncDoc {
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
}
```

### 4. SettingsAdapter - 用户设置同步

**文件**: `src/lib/sync/adapters/SettingsAdapter.ts`

**同步范围**: 用户偏好设置

**数据源**: 多个 Zustand Store 合并
- `useUiPreferences` - UI 偏好
- `useMarkdownPreferences` - Markdown 偏好

**特点**:
- 使用固定 ID `'user-settings'`
- 合并多个 Store 的状态

```typescript
interface SettingsSyncDoc extends SyncDoc {
  id: 'user-settings';
  uiPreferences?: {
    sidebarCollapsed?: boolean;
    theme?: string;
    // ...
  };
  markdownPreferences?: {
    fontSize?: number;
    lineHeight?: number;
    // ...
  };
}
```

---

## 冲突解决策略

### 规则

冲突解决采用**确定性规则**，确保所有设备得出相同结论：

1. **时间戳优先**: 比较 `updated_at`，较新的胜出
2. **设备ID字典序**: 若时间戳相同，比较 `device_id` 字典序，较大的胜出

### 实现

```typescript
// src/lib/sync/core/ConflictResolver.ts

function shouldLocalWin(local: ConflictMetadata, remote?: SyncMetadataEntry): boolean {
  if (!remote) return true;
  
  if (local.updated_at !== remote.updated_at) {
    return local.updated_at > remote.updated_at;
  }
  
  return lexCompare(local.device_id, remote.device_id) > 0;
}

function getConflictWinner(local: ConflictMetadata, remote: SyncMetadataEntry): 'local' | 'remote' | 'equal' {
  // 返回胜出方
}
```

### 软删除处理

- 删除操作记录为 `deleted_at` 时间戳
- 冲突解决同样适用于删除操作
- 只有当删除操作"胜出"时才执行本地删除

---

## 扩展指南

### 添加新的数据类型

1. **定义类型** (可选更新 `SyncDataType`)

```typescript
// src/lib/sync/core/types.ts
export type SyncDataType = 'prompts' | 'skills' | 'providers' | 'settings' | 'newType';

export const SYNC_DATA_TYPE_INFO: Record<SyncDataType, { label: string; description: string }> = {
  // ... 添加新类型信息
  newType: {
    label: '新类型',
    description: '新类型的描述',
  },
};
```

2. **创建适配器**

```typescript
// src/lib/sync/adapters/NewTypeAdapter.ts
import { BaseSyncAdapter, type SyncDoc } from '../core/SyncAdapter';
import type { SyncDataType, SyncItem } from '../core/types';

export interface NewTypeSyncDoc extends SyncDoc {
  // 定义远端数据格式
}

export interface NewTypeSyncItem extends SyncItem {
  // 定义本地数据格式
}

export class NewTypeAdapter extends BaseSyncAdapter<NewTypeSyncItem, NewTypeSyncDoc> {
  readonly dataType: SyncDataType = 'newType';
  readonly remotePath = 'newtype/data';
  readonly displayName = '新类型';

  async getLocalItems(): Promise<NewTypeSyncItem[]> {
    // 实现获取本地数据
  }

  async createLocalItem(item: NewTypeSyncItem): Promise<void> {
    // 实现创建本地数据
  }

  async updateLocalItem(id: string, item: Partial<NewTypeSyncItem>): Promise<void> {
    // 实现更新本地数据
  }

  async deleteLocalItem(id: string): Promise<void> {
    // 实现删除本地数据
  }

  toSyncDoc(item: NewTypeSyncItem, deviceId: string): NewTypeSyncDoc {
    // 转换为远端格式
  }

  fromSyncDoc(doc: NewTypeSyncDoc): NewTypeSyncItem {
    // 转换为本地格式
  }
}

export function createNewTypeAdapter(): NewTypeAdapter {
  return new NewTypeAdapter();
}
```

3. **导出适配器**

```typescript
// src/lib/sync/adapters/index.ts
export { NewTypeAdapter, createNewTypeAdapter } from './NewTypeAdapter';
```

4. **注册到 SyncStore**

```typescript
// src/store/webDavSyncStore.ts
// 在 performSync 方法中添加适配器注册
import { createNewTypeAdapter } from '@/lib/sync/adapters';

// adapters 映射中添加
adapters.set('newType', createNewTypeAdapter());
```

### 添加新的传输层后端

1. **实现 SyncTransport 接口**

```typescript
// src/lib/sync/transports/S3Transport.ts
import type { SyncTransport, MetadataResult, ItemResult } from '../core/SyncTransport';
import type { SyncMetadataFile } from '../core/types';
import type { SyncDoc } from '../core/SyncAdapter';

export class S3Transport implements SyncTransport {
  readonly type = 's3';
  readonly displayName = 'Amazon S3';

  async checkConnection(): Promise<boolean> {
    // 实现连接检查
  }

  async ensureDirectory(path: string): Promise<void> {
    // S3 不需要创建目录，可空实现
  }

  async getMetadata(path: string): Promise<MetadataResult> {
    // 实现获取元数据
  }

  async putMetadata(path: string, data: SyncMetadataFile): Promise<void> {
    // 实现保存元数据
  }

  async getItem<D extends SyncDoc>(path: string): Promise<ItemResult<D>> {
    // 实现获取数据项
  }

  async putItem(path: string, data: SyncDoc): Promise<void> {
    // 实现保存数据项
  }
}

export function createS3Transport(config: S3TransportConfig): S3Transport {
  return new S3Transport(config);
}
```

2. **导出传输层**

```typescript
// src/lib/sync/transports/index.ts
export { S3Transport, createS3Transport } from './S3Transport';
```

---

## API 参考

### SyncManager

```typescript
class SyncManager {
  constructor(deviceId: string, transport: SyncTransport, adapters?: Map<SyncDataType, SyncAdapter>)

  // 检查远端连接
  checkConnection(): Promise<boolean>

  // 同步单个数据类型
  syncDataType(dataType: SyncDataType, direction: SyncDirection): Promise<SyncResult>

  // 同步所有（或指定）数据类型
  syncAll(direction: SyncDirection, dataTypes?: SyncDataType[]): Promise<FullSyncResult>

  // 注册适配器
  registerAdapter(adapter: SyncAdapter): void

  // 获取适配器
  getAdapter(dataType: SyncDataType): SyncAdapter | undefined

  // 获取已注册的数据类型
  getRegisteredDataTypes(): SyncDataType[]
}

// 工厂函数
function createSyncManager(config: SyncManagerConfig): SyncManager
```

### SyncResult

```typescript
interface SyncResult {
  dataType: SyncDataType;
  success: boolean;
  error?: string;
  pushed: number;    // 推送数量
  pulled: number;    // 拉取数量
  deleted: number;   // 删除数量
  conflicts: number; // 冲突数量
}
```

### FullSyncResult

```typescript
interface FullSyncResult {
  success: boolean;
  results: SyncResult[];
  totalPushed: number;
  totalPulled: number;
  totalDeleted: number;
  totalConflicts: number;
  errors: string[];
}
```

---

## 使用示例

### 手动触发同步

```typescript
import { useWebDavSyncStore } from '@/store/webDavSyncStore';

// 获取 store
const syncStore = useWebDavSyncStore.getState();

// 执行双向同步
await syncStore.performSync('both');

// 仅推送
await syncStore.performSync('push');

// 仅拉取
await syncStore.performSync('pull');
```

### 检查同步状态

```typescript
const { syncStatus, lastSyncTime, connectionStatus } = useWebDavSyncStore();

// syncStatus: 'idle' | 'syncing' | 'success' | 'error'
// connectionStatus: 'unknown' | 'checking' | 'connected' | 'disconnected'
```

### 配置同步数据类型

```typescript
const { enabledDataTypes, toggleDataType, setEnabledDataTypes } = useWebDavSyncStore();

// 切换单个类型
toggleDataType('skills');

// 设置全部类型
setEnabledDataTypes(['prompts', 'settings']);
```

---

## 注意事项

1. **设备ID**: 每个设备自动生成唯一ID，存储在本地，用于冲突解决
2. **元数据版本**: 当前版本为 `1`，后续升级需考虑兼容性
3. **ETag 支持**: WebDAV 传输层支持 ETag 用于乐观锁，但当前未强制使用
4. **错误处理**: 单个数据类型同步失败不影响其他类型

---

## 更新日志

### 2026-02

- 初始版本
- 支持 4 种数据类型：prompts、skills、providers、settings
- 实现 WebDAV 传输层
- 实现确定性冲突解决策略
- 集成自动同步触发机制
