# Chatless 默认权限边界

本文档描述桌面端（Tauri 2）默认授予的能力，以及 Agent 读写文件时实际生效的规则。
配置见 [`src-tauri/capabilities/main.json`](../src-tauri/capabilities/main.json)。

## 文件系统（FS）

| 范围 | 默认 |
|------|------|
| `$APPDATA`（应用数据、日志、`file-history`） | 应用自身读写 |
| 会话工作目录 `文档/Chatless/<标题>-<短ID>`（旧会话沿用 `$APPDATA/workspaces/<id>`） | 会话内读写；**按调用授权**，不写入持久白名单 |
| 用户主动附加的目录 | 加入持久白名单（`source: attachment`），可在设置里撤销 |
| Desktop / Downloads / 其他路径 | 不默认开放；越界访问弹出审批卡片（仅本次 / 以后都允许） |
| 删除 | 始终需要单独审批，且默认工作目录条目不含 delete 权限 |

实现要点：

- 后端 `FilesystemAllowlistState` 是最终边界，校验真实路径（含符号链接与 Windows 联接点解析）。
- 会话工作目录的授权来自运行期合成的 `@WorkDir` 条目 + 每次调用的 call-scoped grant；
  这样新建会话不会往用户的安全设置里塞一条 UUID 路径。
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

- `dangerous.all`：未启用。
- 仍允许 `http://*:*` / `https://*:*`（Provider 与模型下载兼容）；收紧需动态 capability，
  单独里程碑处理。

## 退出清理

- 前端 `cleanup_on_exit` → Rust `release_onnx_session`，释放 ONNX session。
