# Agent 核心路径最终验收（2026-09-22）

基线 `5bdb6c2`。本轮针对「进程能力 / 编辑与搜索 / 失败可见性」计划收尾，并把
评测从「夹具重写工具」改成「真实适配器 + 真实 Rust 命令」。

## 1. 结论

计划中的代码缺陷全部关闭，并且第一次有了**走真实命令层**的效果证据。
未完成的部分集中在真实桌面 WebDriver 流程：会话能建立、页面能检查、模型面板能
操作，但脚本化的「打字 → 发送 → 等回答」没有真正提交，因此桌面全流程仍记为
**未验证**。

## 2. 关闭的问题与依据

| 问题 | 修复 | 依据 |
|---|---|---|
| `shell__start` 自行拆分命令，显式 shell 无效、带反斜杠的引号路径被破坏 | `run` 与 `start` 共用一个命令计划：整行交给解释器，显式 shell 严格生效 | `src/lib/shell/commandPlan.ts`；`src/lib/shell/__tests__/commandPlan.test.ts`（4 通过） |
| Tauri 参数名错误（`execution_id` vs `executionId`），mock 测试通过但真实 IPC 失败 | 顶层参数改回 camelCase，并新增「Rust 签名 ↔ 每个 invoke 调用点」契约测试 | `src/lib/tauri/__tests__/invokeContract.test.ts`；`src/lib/skills/sandbox/ProcessSandbox.ts` |
| 后台进程无会话归属、限额是全应用、停止先注销再终止 | 进程表增加会话/运行归属，读/停/列出按会话校验，删除会话终止其进程，限额按会话预留，停止成功后才改状态并保留收尾日志 | `src-tauri/src/sandbox/commands.rs`；`notes` 见 §3 的 Rust 测试 |
| Agent 启动工具后立即注销取消登记，停止任务杀不掉后台服务 | 登记保留到运行结束，取消时才终止该运行启动的进程 | `src/lib/mcp/agentLoop/AgentLoopRunner.ts` |
| 失败结果被 `throw` 重新包装，stdout/stderr/退出码/编辑候选丢失，已知失败被当成「结果未知」 | 结构化失败原样回传，只加 `resultStatus: 'failed'`；只有真无法判断时才 `unknown` | `src/lib/mcp/pipeline/toolResultDiagnostics.ts`（`markKnownFailure`）、`ToolExecutionPipeline.ts` |
| 搜索只校验根目录，符号链接可越界读取 | 遍历前不跟随链接，跳过并记录原因；返回扫描数、跳过原因、`partial`、`truncated` | `src-tauri/src/filesystem/commands.rs`；测试 `search_never_follows_links_out_of_the_root` |
| 文件名无法搜索；读取失败被静默忽略 | `mode: content/filename/both`，命中带 `kind`，文件名命中不伪造行号 | 同上；测试 `search_finds_files_by_name_without_inventing_a_line` |
| 编辑零匹配只给文件前几行；缺 `replace` 会静默删除原文 | 候选按相似度排序；`replace` 缺失直接报参数错误 | `apply_edit`/`closest_lines`；`FilesystemAdapter` 的 `INVALID_ARGUMENTS` 分支 |
| 同文件并发编辑、写入失败丢内容 | 按真实路径串行化 + 同目录临时文件提交；`expectedHash` 不匹配返回 `FILE_CHANGED` | `write_lock_for` / `write_file_atomically` / `edit_file_inner` |
| Shell 强制改写 `HOME/USERPROFILE`，git/ssh 读不到用户配置 | 继承用户环境 | `src-tauri/src/sandbox/commands.rs` |
| 省略 `workingDir` 时没有落实 `@WorkDir` 默认值 | 审批门之前解析会话工作目录，卡片与后端一致 | `ToolExecutionPipeline.ts` |
| **`cmd /c` 引号语义**：Rust 把带引号参数转义成 `\"`，cmd 原样交给程序，`node -e "process.exit(3)"` 退出 0 | 命令计划标记「整行原样传入」，后端用 `raw_arg` 加 `cmd /c` 需要的那层引号；PowerShell/bash 保持默认转义 | `commandPlan.verbatimLastArg`、Rust `apply_program_args`；测试 `a_quoted_command_line_reaches_the_program_unchanged` |

## 3. 本轮实际执行的检查

| 检查 | 命令 | 结果 |
|---|---|---|
| TypeScript | `pnpm typecheck` | 通过 |
| Lint | `pnpm lint:ci` | 通过（0 warning） |
| 前端测试 | `pnpm test` | 62 文件 / 276 测试通过 |
| Rust 测试 | `cargo test --lib` | 40 通过 / 4 ignored |
| 真实子进程 | 同上 | 超时仍返回已打印输出、受管进程读写停、跨会话拒绝、每会话上限、父子进程树 2 秒内终止、静态站点端到端 |
| WebDriver 会话 | `tauri-driver` + `msedgedriver 153.0.4234.48` | 会话可建立，可读取真实 DOM |

## 4. 真实 Agent 效果验收（homelab / Qwen3.8-Flash-Next-medium）

命令：

```
CHATLESS_QWEN=1 CHATLESS_QWEN_RUNS=3 pnpm exec vitest run \
  --config docs/acceptance/vitest.config.ts docs/acceptance/qwen-acceptance.audit.test.ts
```

- 24 道题 × 3 次 = 72 次；**完成率 97.2%（70/72）**，权限越界 **0**，重复副作用 **0**。
- 终态分布：`answered` 71、`step-limit` 1。
- 默认提示词 + 工具定义 ≈ **2962 tokens**（目标 ≤4000），工具 18 个。
- 执行路径：`qwen-acceptance.audit.test.ts` → 生产 `FilesystemAdapter`/`ShellExecutorAdapter`
  → `src-tauri/examples/cmd_bridge.rs`（真实 `chatless_lib` 命令，真实 allowlist、进程表、编辑语义）。

两个失败样例（保留，不改成通过）：

1. `fs-list` 第 1 次：模型声称「本步骤只有审计工具」，未调用任何工具就作答。
   同题另两次通过。属模型行为，与工具链无关。
2. `shell-run-and-report-failure` 第 1 次：12 步用尽仍未给出退出码（`step-limit`）。
   在修正 `cmd` 引号语义后单独重跑 3/3 通过，且一次调用即返回 `exitCode: 3`。

该评测同时暴露了一个真实结论：**文件白名单不能约束已信任的 Shell**。模型在
`fs__read C:\Windows\win.ini` 被拒后改用 `shell__run type ...` 成功读取。
这与既定设计一致（Shell 信任是独立、更粗的授权，命令以当前用户权限运行），
因此两个越权用例改为在「未授予 Shell 信任」的条件下判定，并在报告中标注。

## 5. 未完成：真实桌面全流程

已具备：

- `pnpm` 之外的一条命令：`node scripts/e2e/desktop-e2e.mjs`
- 脚本自行启动/关闭 `tauri-driver`，清理上一次残留实例，带 45 秒 RPC 超时与看门狗
- 隔离标识 `com.kamjin.chatless.e2e` 与隔离数据目录；默认拒绝驱动 `target/debug`（开发构建）
- 会话建立成功并读取到真实页面（`http://tauri.localhost/chat`，标题栏按钮、`选择模型`、`开启仅规划`、textarea 均可见）
- 通过页面内部 API 写入 composer 文本

关键阻塞与证据：

- **已在代码中修好的根因**：wry 总会设置 `AdditionalBrowserArguments`，会覆盖
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 环境变量，所以只有把
  `--remote-debugging-port=0` 写进窗口配置，WebDriver 才能建立会话。
  该配置已加入 `src-tauri/tauri.e2e.conf.json`。
- **仍然失败的步骤**：写入 composer 文本后，发送动作没有真正提交——
  WebDriver 会记录点击/输入为「not interactable / click intercepted」（有浮层覆盖输入区），
  改用页面内 `button.click()` 后，数据库仍然**没有任何 conversation / message 行**，
  即应用没有收到这次发送。因此 `chat-send`、`agent-writes-file`、`agent-runs-shell`、
  `stop-a-running-task` 四个流程本轮**未通过**，报告写入 `CHATLESS_E2E_REPORT` 指向的文件。

未验证项（保留为缺口，不当作已通过）：

- 桌面端发送/停止/审批/重启继续的端到端结果
- 跨平台（仅 Windows 实测）
- `knowledge__*` 仍使用夹具：真实 `KnowledgeAdapter` 绑定应用数据库与检索服务，
  不在当前 harness 的运行范围内
- 五万分块 Dense＋融合 P95 未在本次重测，沿用 `docs/acceptance/dense-*.json`（2026-09-21）
- 真实使用样本题集（当前为人工构造的中英文题集）

## 6. 复现方式

```
pnpm typecheck && pnpm lint:ci && pnpm test
cd src-tauri && cargo test --lib

# 真实 Agent 评测（需要 homelab 端点）
CHATLESS_QWEN=1 CHATLESS_QWEN_RUNS=3 pnpm exec vitest run \
  --config docs/acceptance/vitest.config.ts docs/acceptance/qwen-acceptance.audit.test.ts

# 桌面 WebDriver（隔离构建 + 隔离数据目录）
cd src-tauri && cargo build --target-dir target-e2e
CHATLESS_E2E_APP=<repo>/src-tauri/target-e2e/debug/chatless.exe \
CHATLESS_E2E_DATA_DIR=%APPDATA%/com.kamjin.chatless.e2e \
CHATLESS_E2E_WORKSPACE=%TEMP%/chatless-e2e-workspace \
node scripts/e2e/desktop-e2e.mjs
```
