# Chatless 默认权限边界

本文档描述桌面端（Tauri 2）**默认**授予应用的能力。用户通过设置中的目录授权（allowlist）可额外开放路径；Coding Pack 等 Labs 功能默认关闭。

## 文件系统（FS）

| 范围 | 默认 |
|------|------|
| `$APPDATA` / `$APPLOG` | 读写（应用数据与日志） |
| Desktop / Documents / Downloads | **不**默认开放 |
| 用户工作区 / 附件目录 | 经 allowlist 或会话 `@WorkDir` 挂载后可用 |

配置见 [`src-tauri/capabilities/main.json`](../src-tauri/capabilities/main.json)。

## Shell（`run_safe_shell`）

- **strict 模式**：默认开启
- **命令白名单**：常见只读/诊断命令；高风险命令需 ToolCard 审批
- **工作目录**：限制在应用数据目录、临时目录及用户授权路径

实现见 [`src-tauri/src/sandbox/commands.rs`](../src-tauri/src/sandbox/commands.rs)。

## HTTP

- `dangerous.all`：**未**启用
- 当前仍允许 `http://*:*` / `https://*:*`（Provider 与模型下载兼容）；收紧需动态 capability，单独里程碑处理

## Opener

- `opener:allow-open-path` 限于 `$APPDATA` / `$APPLOG`
- `opener:default` 仍保留（打开链接等基础能力）

## 与 Agent / 工具的关系

- 工具副作用走运行时策略 + allowlist，不靠模型自律
- Coding Pack：默认关；`attach` 写入 allowlist；`apply_patch` 仅预览，写入需审批

## 退出清理

- 前端 `cleanup_on_exit` → Rust `release_onnx_session`，释放 ONNX session
