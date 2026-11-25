# WebDAV 同步框架

> 状态（2026-11-25 按 `main` 重写）。上一版（2026-02）把 interface 与 adapter 的签名抄了一遍——
> 那类内容漂移得最快，现在一律改指代码。这里只留重新发现成本最高的东西：不变量、坑、加一个
> 数据类型要动哪几处、以及哪条路是死的。

## 一句话模型

四个数据类型：`prompts` / `skills` / `providers` / `settings`（`SyncDataType`）。服务器上的形状是
**每条记录一个 JSON 文档**：`<类型>/data/<item.id>.json`（`PromptAdapter` 用 `prompts/data`，
`skills/data`、`providers/data`、`settings/data` 同理），外加一份放在**同一个目录**里的
`<类型>/data/metadata.json`（`metaPath` 就是拿 `adapter.remotePath` 拼的）存每条记录的
`updated_at` / `device_id` / `deleted_at`。只有 settings 恰好只有一条记录（`user-settings`），所以
看起来像"一个类型一个文档"，别把它当通则。一次同步就是「读远端 metadata → 与本地比 → 该推的推、
该拉的拉」，冲突靠确定性规则判胜负，不靠合并内容。

密钥不参与同步：`ProviderAdapter` 明确不写 `apiKey`（还有 `status` / `lastChecked` 等），同步文档里没有
它，`SYNC_DATA_TYPE_INFO` 里那句「不含密钥」不是装饰。

## 入口在哪

| 要做什么 | 在哪 |
|---|---|
| 用户配连接、点「立即同步」 | `src/components/settings/WebDavSyncSettings.tsx` → `src/store/webDavSyncStore.ts`（连接参数、`enabled`、`autoSync` 都存在这个 store） |
| 执行一次同步 | `webDavSyncStore.performSync(direction)`。SyncManager、四个 adapter、WebDAVTransport 都是**动态 import**：没开同步就不该把这些代码载进包里，别改成静态导入 |
| 数据变更后自动同步 | `src/lib/sync/prompts/autoSync.ts` 的 `triggerPromptSync()`：5 秒防抖，且要求 `enabled && autoSync` 与连接参数齐全才排程。**目前只有 `promptStore` 在写操作后调它**，技能 / 提供商 / 偏好的改动不会自动排程同步 |
| 某类数据怎么进出本地 | `src/lib/sync/adapters/`，每个 adapter 继承 `BaseSyncAdapter`：抽象部分是 `dataType` / `remotePath` / `displayName` 加 `getLocalItems` / `getLocalItem` / `localItemExists` / `createLocalItem` / `updateLocalItem` / `deleteLocalItem` / `toSyncDoc` / `fromSyncDoc`，另有两件事**有默认实现，但只有部分 adapter 真的覆写**：`extractMetadata`（`PromptAdapter` /
`SkillAdapter` 有实现，providers / settings 用默认）与同步结束后的 `onSyncComplete`——**四个里只有
`PromptAdapter` 靠它刷新界面**（`loadFromDatabase()`），另外三个是空实现：skills 的 store 自己
persist、providers 靠 CacheManager 广播、settings 在 setter 里就落库 |
| 冲突判定 | `src/lib/sync/core/ConflictResolver.ts` |
| 与服务器对话 | `src/lib/sync/transports/WebDAVTransport.ts` → `src/lib/sync/webdav/WebDavClient.ts` |
| 设备身份 | `src/lib/sync/deviceId.ts`（一次安装一个稳定 id，它同时是冲突 tie-break 的判据） |

## 四条不变量（破了就不是这套同步了）

1. **metadata 写入是 ETag 上的 compare-and-swap，且强制**。拿不到 strong ETag（缺失、`*`、以
   `W/` 开头）就抛 `Cannot safely write WebDAV resource without a strong ETag: <路径>`，绝不盲写；
   Apache 会把刚写完的文件短暂标成 weak ETag，所以 `readForConditionalWrite` 等 1.1 s 重读一次，
   永不拿 weak ETag 当 `If-Match`；`isPreconditionFailure` 认 412/precondition，整轮最多重来
   `MAX_CONFLICT_ATTEMPTS`（3）次。为什么这么讲究：2026-10 的架构审查（
   `docs/architecture/final-review-2026-10-24.md` 的 R8）实测到一次 412 恢复把较新的远端 metadata
   滚回旧版本，随后第三台设备一推就覆盖了新内容（那次审查用的是夹具复现，不是真服务器事故）。
   旧版本文档写「ETag 支持乐观锁，但当前未强制使用」——那是 2026-02 的事实，今天恰好相反，别再
   照着它以为 412 只是重试信号。**数据文档本身也走同一套**：推一条已存在的记录时会重新读一遍
   body、按 body 自己的 `updated_at` / `device_id` 再判一次胜负，并带 body 的 ETag 写，避免
   metadata 说新、body 还是旧。前置条件不只挂在 metadata 上。
2. **冲突解决必须确定性**：先比 `updated_at`，再比 `device_id` 字典序（`shouldLocalWin` /
   `shouldRemoteWin`），不看内容。同一对状态在哪台设备上算、按什么顺序算，结果都要一样。
3. **删除是软删除 tombstone**（`deleted_at`），一个落后的快照不能把赢的一方删掉的东西复活——
   `SyncManager` 里那句 "A losing snapshot may carry a tombstone the winning version removed"
   说的就是这件事，改合并顺序时先读它。落到 adapter 上分四种：prompts 写 `deleted_at`（并把
   `updated_at` 抬到删除时刻）；providers 的删除是「隐藏」（`setVisibility(false)`），条目还在库里；
   skills 的删除是把 `enabled` 置 false，**它不推进 `updated_at`**（见下条）；settings 根本不支持删除
   （no-op）。
4. **胜负看 `updated_at`，而各 adapter 填它的方式不一样**，这是"我改了但同步没动"的头号原因：
   providers 用 `lastChecked || Date.now()`，skills 用 `installedAt || Date.now()`，settings 每次采集
   打一个 `Date.now()`。后果具体：改 provider 的 URL、切技能的启用状态（含上面那种"删除"）都不会推进 `updated_at`，
   这一改动在冲突里赢不了；settings 是整文档 last-writer-wins，没有字段级合并，所以它几乎总是本地胜。
   （metadata 文件另有 `version: 1`，目前是 `types.ts` 里的字面量类型，读入处没有版本分支——真要改字段
   形状，得先在那儿加兼容，不是把数字加 1 就完事。）

## 加一个数据类型：漏一项就是半接线

`SyncDataType` 联合类型 + `SYNC_DATA_TYPE_INFO` 的展示文案 → 新 adapter（继承 `BaseSyncAdapter`，
想清楚 `extractMetadata` 和 `onSyncComplete` 要不要覆写）→ adapter 注册进 `performSync` → store 的
`ALL_SYNC_DATA_TYPES` 与设置页勾选 → `src/i18n/` 两份词条 + `src/i18n/types.ts`。少一处表现为
「能同步但界面勾不到」或「勾了但同步里没它」；需要拉完之后刷新界面的类型必须覆写 `onSyncComplete`，
否则症状是「同步报告成功，界面不刷新」——今天只有 `PromptAdapter` 需要并做到了。

## 已知的死路径（别在错的那份上改）

`src/lib/sync/prompts/webdavPromptSync.ts` 及其配套的 metadata 处理没有任何生产调用方（全仓只有
本文旧版提过它）。真正在跑的是 `prompts/autoSync.ts` → `webDavSyncStore.performSync`。看到
「prompt 同步有两套实现」时，`webdavPromptSync.ts` 是遗留；它里面还自带一套
`shouldLocalWin` / `shouldRemoteWin`，所以改 `ConflictResolver` 不会传到它——别以为改了一处就两边一致。
另一个死角是 `getConflictWinner`：零调用方，只有 `core/index.ts` 再导出它。删这些要单独一次改动。

## 怎么检查它

注意 `MAX_CONFLICT_ATTEMPTS`（3）是**总共三次尝试**，不是"失败后再重来三次"。

- 单元（都在 `pnpm test` 里）：`src/lib/sync/core/__tests__/SyncManager.conflict.test.ts`、
  `src/lib/sync/transports/__tests__/WebDAVTransport.test.ts`、
  `src/components/settings/__tests__/WebDavSyncSettings.test.ts`。
- 手工：设置 → 同步里先「检测连接」（`settings.sync.checkConnection`）再「立即同步」
  （`settings.sync.syncNow`）；然后两台设备各改同一条提示词，第二次同步应当保留较新的那条，
  且不把已删除的那条复活。ETag compare-and-swap 的失败分支只有真服务器能给，测试里是夹具。
