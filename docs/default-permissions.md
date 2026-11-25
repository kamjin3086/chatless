# Chatless 默认权限边界

本文档描述桌面端（Tauri 2）默认授予的能力，以及 Agent 读写文件时实际生效的规则。
配置见 [`src-tauri/capabilities/main.json`](../src-tauri/capabilities/main.json)。

## 文件系统（FS）

| 范围 | 默认 |
|------|------|
| 应用自己的目录（`$APPDATA` 一类：数据库、`file-history`、白名单持久化） | 应用自身读写；三平台的确切位置见 `docs/llm-troubleshooting.md` 的表——macOS 的日志不在应用数据目录里，数据库在 config 目录而不是 data 目录 |
| 会话工作目录 `文档/Chatless/<标题>-<会话摘要>`（目录名在 `src-tauri/src/workspace/naming.rs`；旧会话沿用 `workspaces/<会话 id>`） | 会话内读写；**按调用授权**，不写入持久白名单，且这类授权只给 read/write/create——`delete` 为 false（`src/lib/mcp/pipeline/ToolExecutionPipeline.ts`） |
| 侧栏工作区目录 | 已绑定会话的 `@WorkDir` 和命令默认目录；打开目录、在其中新建会话或用 `@` 插入路径都不授予 Agent 读写权限 |
| Desktop / Downloads / 其他路径 | 不默认开放；越界访问弹出审批卡片（仅本次 / 以后都允许） |
| 删除 | 始终需要单独审批，且默认工作目录条目不含 delete 权限 |

实现要点：

- 后端 `FilesystemAllowlistState` 是最终边界，校验真实路径（含符号链接与 Windows 联接点解析）。
- `@WorkDir` 优先指向该会话绑定的工作区；未绑定的会话才使用自带的产物目录。工具按同一个目录解析相对路径。
  只有作为 `@WorkDir` 的自带产物目录才有默认的 call-scoped grant；绑定项目目录不继承这项权限。
- Agent 文件工具访问侧栏工作区时沿用常规文件审批；用户可在「隐私与安全 → 文件访问白名单」管理长期权限。
  `@` 面板只为当前界面调用临时授权列目录，选中文件只插入路径，不读取文件内容或写入白名单。
- 路径里未解析的 `@Alias`（或无法解析的相对路径）会返回结构化错误 `UNRESOLVED_ALIAS`，
  不会把字面量 `@WorkDir` 当作目录创建出来。
- 覆盖/编辑前的内容会存到 `$APPDATA/file-history/<路径哈希>/`：每文件保留最近 20 版、
  全局上限 200 MB，可在消息的“改动的文件”里恢复；恢复前会再存一次当前内容。
- 用系统默认程序打开文件/目录走 `filesystem_open_path` 命令（同一套 allowlist 校验），
  不依赖前端 opener 插件的固定目录作用域。

## Shell（`shell__run` / `shell__start`）

- 命令是否执行由**用户的 Shell 信任**决定（本次允许 / 本会话不再询问 / 始终允许），
  与文件系统授权相互独立。
- 命令以当前系统用户权限运行：工作目录限制不是操作系统沙箱。
- 只保留破坏性命令模式的后端底线拦截；没有“命令白名单”或 strict 模式。
- 解释器由命令计划统一决定：Windows 默认 `cmd`（整行原样传入，含引号语义），
  macOS/Linux 默认 `bash`；显式 `shell` 参数严格生效。
- 后台进程归属到会话：仅本会话可读取/停止，会话删除与应用退出时终止。

## HTTP

- `dangerous.all`：未启用（`src-tauri/capabilities/main.json` 里没有这一项）。
- `http:default` 的允许名单是四条：`http://localhost:*`、`http://127.0.0.1:*`、`https://*`、
  `http://*:*`。也就是说 https 侧目前是开放的，http 侧只按主机与端口形状收紧过；再往下收需要
  动态 capability，另立里程碑，不在默认权限里顺手做。

## 退出清理

- 前端在退出时调 `cleanup_on_exit`（`src/lib/services/appCleanup.ts`），Rust 侧走
  `clear_onnx_sessions` 释放全部 ONNX session。单个会话的释放是另一条命令
  `release_onnx_session`（`src/lib/embedding/strategies/OrtEmbeddingStrategy.ts` 用），别把两者混为一句。
