# 工作目录语义与输出预算：复验记录

日期：2026-09-22。范围：上一次验收不通过的 8 个专项门槛，以及两条真实 Rust 探针
确认的缺陷（授权撤销后无法查看历史、备份失败仍覆盖原文件）。

不扩展到整个 Agent/RAG 的效果评测，不处理遗留数据迁移。

## 结论

**专项门槛全部通过；真实后端探针全部反转为期望行为。**

上一次的判断是"核心辅助函数通过、入口没接通"。这一轮把入口本身收敛掉了：
凡是写用户文件系统的动作（建目录、写清单、导出、清理）都归 Rust 所有，前端只持有
类型化封装；输出预算只有一个判定点。桌面点击流程仍未在本轮实测（见文末"未验证项"）。

## 上一轮 8 个门槛的现状

门槛文件仍然是 [workspace-budget.audit.test.ts](acceptance/workspace-budget.audit.test.ts)，
现在随 `pnpm test` 常跑（`vitest.config.ts` 显式包含），不再需要单独一次验收命令。
每条的行为落到修复后的实现位置：

（2026-09-24 补充：文件里现在是 16 条门槛。新增的三条覆盖"工作目录用到才建"——
只解析路径不建目录、第一次真正使用时才落地、已经落地后不再重复走 IPC。）

| # | 上次失败的行为 | 现在 | 落点 |
|---|---|---|---|
| 1 | 8K 窗口下默认仍下发 8192 | 自适应下发 2048 | `ModelParametersService.applyOutputBudget` |
| 2 | 窗口未知时下发隐式默认值 | 不下发 | 同上 + `resolveOutputBudget` |
| 3 | 参数对话框里"关闭"后又被填回 8192 | 关闭即不下发 | `enableMaxTokens === false` 分支 |
| 4 | 导出读取不存在的 `entry.path`，复制 0 个文件仍报成功 | 复制在 Rust 内按真实目录项进行，界面显示真实计数 | `workspace_export` |
| 5 | 清理失败被吞掉，界面显示成功 | 命令失败即抛出，记录保留、可重试 | `workspace_trash` / `trashConversationWorkspaces` |
| 6 | 两个会话共用六位短 ID 前缀会指向同一目录 | 目录名取会话 ID 摘要，映射按完整 ID | `workspace/naming.rs`、`workspaces/index.json` |
| 7 | 目录枚举失败被当成空目录，触发改名 | 自动改名已删除：路径一旦建立就不再移动 | `workspace_ensure` |
| 8 | 挂载目录不在重启快照里 | `mountedDirByConversation` 持久化，会话级有效 | `conversationAttachmentStore` |

第 6 条的"目录名唯一"和第 7 条的"读失败不作任何移动"由 Rust 测试断言，
因为它们描述的不再是前端行为：`naming::tests::ids_sharing_a_six_character_prefix_get_different_folders`、
`commands::tests::creates_finds_and_reuses_one_directory_per_conversation`。

## 实现收敛

| 边界 | 之前 | 现在 |
|---|---|---|
| 会话→目录 | 前端按短 ID 扫目录回找，前后端各存一份 | Rust `workspaces/index.json` 唯一持有；位置立刻确定，目录**用到才建** |
| 目录创建/导出/清理 | 渲染进程 plugin-fs（作用域只覆盖 `$APPDATA`，实际无权写文档目录） | Rust `workspace_*` 命令，带结构化错误码 |
| 会话清单 | 前端 plugin-fs 直接读写文档目录，静默失败 | `workspace_read_manifest` / `workspace_write_manifest` |
| 附加目录 | 选目录即写入全局白名单（隐式长期授权） | 仅会话级映射 + 每次调用按调用授权 |
| 输出预算 | 默认参数把 8192 变成"用户显式值" | `enableMaxTokens` 三态（自动/手动/关闭），单一判定点 |
| 上下文窗口 | 用户值与服务端上报共用同一字段，只填第一次 | `contextWindow` 与 `observedContextWindow` 分开，取较小值 |
| 文件历史 | 备份失败仍覆盖；版本 ID 可能撞车；恢复经字符串往返 | 备份失败即拒绝写入；ID 唯一；按字节恢复并校验哈希 |
| 历史/导出入口 | UI 直接调后端，没有授权衔接 | 一次性授权（`withOneShotGrant`），用完立即撤销 |
| 清理 | plugin-fs `remove`（永久删除） | 系统回收站（`trash` crate），失败不退化为删除 |
| 前端调用后端 | 每个模块各写一份 invoke + 大小写转换 | 统一 `invokeBackend`，参数契约由机械检查覆盖 |

## 本轮实际执行的检查

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型 | `pnpm typecheck` | 通过 |
| Lint | `pnpm lint:ci` | 通过（无 warning） |
| 前端回归 | `pnpm test` | 67 文件 / 314 测试通过，含 16 条本门槛 |
| Rust | `cargo test --lib` | 68 通过 / 0 失败 / 4 ignored |
| Rust 编译告警 | `cargo check --lib --examples` | 无 warning |
| Tauri 参数契约 | `src/lib/tauri/__tests__/invokeContract.test.ts` | 通过；已扩展到共享封装 `invokeBackend`，新增命令不会绕过检查 |
| 真实后端探针 | `cargo build --example cmd_bridge` 后执行 `python docs/acceptance/workspace-history-probe.py src-tauri/target/debug/examples/cmd_bridge.exe` | 全部为期望行为（下节原文） |

## 真实后端探针输出

探针只使用全新临时数据目录与生产 Rust 命令函数，不接触用户文件、不需要桌面会话。

```json
{
  "history": {
    "backupFailureInjected": false,
    "overwriteReportedSuccess": true,
    "historyVersionRecorded": true,
    "contentAfterOverwrite": "version two",
    "originalStillPresent": false,
    "historyWithoutGrantRefused": true,
    "historyWithOneShotGrant": true,
    "historyVersions": 1,
    "restore": { "ok": true, "bytes": "76657273696f6e206f6e65" }
  },
  "historyBackupFailure": {
    "backupFailureInjected": true,
    "overwriteReportedSuccess": null,
    "historyVersionRecorded": false,
    "contentAfterOverwrite": "version one",
    "originalStillPresent": true,
    "historyWithoutGrantRefused": true,
    "historyWithOneShotGrant": true,
    "historyVersions": 0,
    "restore": null
  },
  "workspace": {
    "chatOnlyConversation": {
      "exists": false,
      "folderAbsent": true,
      "documentsFolderAbsent": true,
      "samePathAfterRename": true,
      "exportOfUnusedWorkspaceIsEmpty": true
    },
    "firstUseCreatesTheFolder": true,
    "titleChangeKeepsTheSamePath": true,
    "manifestCreated": true,
    "exportedFiles": 3,
    "exportedNestedFileExists": true,
    "exportInsideSourceRefused": true,
    "exportRefusalCode": "EXPORT_DESTINATION_INSIDE_SOURCE",
    "trashMovedToRecycleBin": true,
    "folderGoneAfterTrash": true,
    "recreatedAtTheSamePath": true
  }
}
```

工作目录现在采用"用到才建"：

- 只聊天的会话：`exists: false`，`Documents/Chatless` 整个目录都不会被创建；改标题也仍然只解析同一个路径。
- 第一次真的用到文件或命令：`firstUseCreatesTheFolder: true`，目录和 manifest 一起出现。
- 导出从未使用过的会话是"空"而不是错误（`exportOfUnusedWorkspaceIsEmpty`）；清理一个不存在的目录仍然会移除记录。

两条历史探针的读法：

- 正常路径：覆盖会先留副本（`historyVersionRecorded: true`），撤销调用授权后直接查历史被拒
  （`historyWithoutGrantRefused: true`），而按 UI 的方式重新授予一次性读权限就能查到并恢复
  （`historyWithOneShotGrant: true`、`restore.ok: true`，字节 `76657273696f6e206f6e65` = `version one`）。
- 备份失败路径：覆盖被**拒绝**（`overwriteReportedSuccess: null` 表示返回错误而非结果），
  文件仍是 `version one`。这正是上次探针暴露 `overwriteReportedSuccess: true` +
  `originalStillPresent: false` 的反面。

## 未验证项

- **桌面点击流程**：本轮没有启动 WebDriver 会话，以下仍未实测：真实点击"打开目录 / 导出 /
  清理 / 历史版本 / 恢复"、卸载附加目录后 Agent 被拒、重启后恢复会话的 @WorkDir。
  代码层面的替代证据是：命令契约由本文件的 12 条前端门槛覆盖，后端行为由 cargo 测试与
  上面的探针覆盖，重启恢复路径由 `loadConversations` / `setCurrentConversation` /
  `deleteConversation` 三处显式解析 @WorkDir。
- **效果与性能**：本轮不涉及，`CHATLESS_QWEN=1` 的 24×3 与五万分块检索沿用既有报告，
  不记作本次通过。

## 复现命令

```powershell
pnpm typecheck
pnpm lint:ci
pnpm test
cd src-tauri
cargo test --lib
cargo build --example cmd_bridge
cd ..
python docs/acceptance/workspace-history-probe.py src-tauri/target/debug/examples/cmd_bridge.exe
```

验收产物不含端点 IP、凭据或用户目录内容。
