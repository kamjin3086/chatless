# Chatless 默认权限边界

本文档描述桌面端（Tauri 2）默认授予的能力，以及 Agent 读写文件时实际生效的规则。
配置见 [`src-tauri/capabilities/main.json`](../src-tauri/capabilities/main.json)。

## 文件系统（FS）

| 范围 | 默认 |
|------|------|
| `$APPDATA`（应用数据、日志、`file-history`） | 应用自身读写 |
| 会话工作目录 `文档/Chatless/<标题>-<短ID>`（旧会话沿用 `$APPDATA/workspaces/<id>`） | 会话内读写；**按调用授权**，不写入持久白名单 |
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

- `dangerous.all`：未启用。
- 仍允许 `http://*:*` / `https://*:*`（Provider 与模型下载兼容）；收紧需动态 capability，
  单独里程碑处理。

## 退出清理

- 前端 `cleanup_on_exit` → Rust `release_onnx_session`，释放 ONNX session。

## Android（实验构建）

配置见 [`src-tauri/capabilities/mobile.json`](../src-tauri/capabilities/mobile.json)，
只对 `android` 平台生效；桌面那一份是 `main.json`。两份不互相继承，Android 不读取
`main.json` 的任何权限。

| 范围 | Android 实际授予 |
|------|------------------|
| 应用私有目录 `$APPDATA` / `$APPLOG` | 读写；会话数据库、设置、文档附件、照片缓存都在这里 |
| 设备存储、相册、下载目录 | **不授予**；只使用系统选择器或拍照后拿到的单个文件／目录授权 |
| SQLite（`sql`） | 与应用私有库同范围 |
| HTTP | `https://*`、`https://*:*` 与 `http://*:*`——与桌面同一范围，任意地址都能填 |
| Opener / Dialog / Log / OS / Store | 插件默认能力；不包含任意路径打开 |
| 系统时钟 | `com.android.alarm.permission.SET_ALARM`——`ACTION_SET_TIMER` 会检查它，缺了就拒收计时请求 |

实现要点：

- 这条范围一度和桌面不同（只开 localhost / 127.0.0.1），结果是手机填一个局域网地址就报
  `url not allowed on the configured scope`——不是连接失败，而是请求根本没出门。手机的模型
  服务常常就在另一台机器上，所以这里开了 `http://*:*`。现在两端都能填任意地址。
- 带端口的 HTTPS 必须单独写一条：`https://*` 实测匹不上 `https://10.0.2.2:8443`（补上
  `https://*:*` 后过），`main.json` 里原本也只有 `https://*`，两边一起补了。
- 想按内网段收窄时不要直接在 capability 里写 IP 通配：Tauri 的 URL pattern 在 hostname 上
  认不了 IPv4 前缀通配，实测 `http://10.*:*`、`http://192.168.*:*`、`http://11.*.*.*:*`
  全部匹配不上 `10.0.2.2` / `192.168.1.20`（`http://*.local:*` 能匹配，`http://[::1]:*`
  则解不过）。真要按网段收，只能在应用侧发请求前判 IP，不能写在这份表里。
- 没有通用 Shell、stdio MCP、工作区命令或 ONNX 嵌入：这些模块在 Android 构建下不编译，
  不是“编译进去了但隐藏”。
- 选目录、选照片、拍照都走 Android 系统界面；应用只拿到用户这一手选中的东西，不给
  Agent 整盘或整相册的遍历权。拿到的是 `content://` 而非路径，不推测真实路径。
- Agent 的四个 Android 工具（文档、目录、照片分组、计时器）都从同一张能力表注册；除计时
  器交接外均为只读，且只在当前会话有对应选择时才出现在模型视野里。
- 目录与照片句柄按会话发放，不携带 URI、路径或内容摘要，换会话不继承。
- Android 构建不上传附件：照片只在用户点发送后交给所选模型；文档在本机解析，只把命中
  的摘录交给模型。
