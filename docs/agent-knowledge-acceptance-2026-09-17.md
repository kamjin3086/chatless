# Agent 与知识库计划完成验收

验收快照基线：`1fc92ab`（包括 `5549f54`），2026-09-17。开始时工作区干净。

> 本文保留首次验收的原始发现，供后续验证逐项关闭。其后已提交：`b02b970`（请求隔离、EOF 和补充顺序）、`b670b25`（重新生成限制和流结束）、`78f0923`（词法索引优先）、`4f8671f`/`4d638a7`（MCP 撤销执行边界及测试）。这些提交关闭了 A1 的部分实现、A2 的自动重放和启用状态缺口、A3，以及 A4 的重新生成重复执行风险；DocumentChunk 迁移、附件统一索引、持久化摘要、真实桌面与性能验收仍未完成。

**结论：不通过整体完成验收。** 两次提交修复了部分缺陷，但没有完成已批准计划。类型检查、Lint 和现有单元测试通过，不代表运行恢复、权限撤销、索引迁移与性能目标已经达成。

本次为代码调用链检查、现有测试重跑和事件投影探针；没有执行真实桌面端或真实模型评测。本文不修改产品实现。

## 验证记录

| 检查 | 本次结果 | 解释 |
|---|---|---|
| `pnpm typecheck` | 通过 | TypeScript 编译检查 |
| `pnpm lint:ci` | 通过 | 无 ESLint 错误或警告 |
| `pnpm test` | 通过：45 文件、197 测试 | 现有测试范围，不等于完整验收用例 |
| `cargo check` | 通过 | 存在原有 manifest key、未使用变量警告 |
| `cargo test --lib` | 通过：11 测试 | 包含输出排空/UTF-8 等测试；未包含新业务事务、重启恢复或真实进程树取消验收 |
| 事件投影探针 | 复现两项缺陷 | 见 A3、A4；临时探针已清理 |
| 真实 SQLite 业务事务/重启验收 | 未验证 | 新增事务命令没有对应的真实 SQLite 回滚与竞争测试 |
| 真实 Tauri、六协议实测、Qwen 24×3 | 未验证 | 不能宣称桌面流程和真实模型通过 |
| 50,000 分块、60 道检索题及延迟/内存 | 未验证 | 无本次测量数据 |

## 阻塞整体完成的问题

### A1 · P0：停止没有取消实际模型请求，SSE 自然结束仍可能悬挂

- `src/lib/mcp/agentLoop/AgentLoopRunner.ts:76` 只中止本地 AbortController 和 Shell；`:353` 调用 `streamChat` 时没有传入取消信号或请求取消句柄。等待结束并不等于网络请求结束。
- `src/lib/llm/Interpreter.ts:82` 仍有共享 `activeProvider`；取消所有权没有完整改成独立请求。
- `src-tauri/src/lib/sse.rs:184` 的 `Some(item) = stream.next()` 在 EOF 时禁用该分支，而 `shutdown_rx.recv()` 仍等待；`else` 不会因为流 EOF 自动执行，因此可能无法到达 `closed`。
- `src/lib/llm/providers/OpenAICompatibleProvider.ts:658` 的 SSE `onClose` 仍只记录日志；没有将非正常协议结束转成错误并结束 Agent 等待。
- `src/lib/sse-client.ts:131` 收到终态仅置状态、调用回调，没有在该路径释放监听与定时器。

处理：将请求 ID、取消和完成 Promise 接通整个 Provider 链；显式处理 Rust 流的 `None`；未完成工具参数的断流必须失败；测试排队取消、连接建立取消、EOF 和跨会话隔离。

### A2 · P0：MCP 底层仍自动重试未知副作用，撤销未在执行边界检查

- `src/lib/mcp/ServerManager.ts:214` 根据错误文本匹配 `session/decode/400/...` 后重连，再于 `:231` 重新 `callTool`。即使外层禁止写操作重试，底层仍可能重复已经成功但响应解析失败的外部操作。
- `src/lib/mcp/pipeline/adapters/McpAdapter.ts:16` 执行只保证连接存在；`executor/ConnectionManager.ts:42` 找到配置后没有拒绝 `enabled === false`，已经连接时甚至不读取配置。

处理：删除副作用未知调用的自动重放；重连仅恢复连接，不重做操作。执行前及审批后重新校验当前启用状态。

### A3 · P0：运行中补充破坏工具消息顺序

`AgentLoopRunner.ts:44` 在工具执行期间立即追加普通 `user_message`。`ConversationEventLog.ts:94` 按事件顺序投影，可能在同一 assistant 的工具结果尚未齐全时插入用户消息。

探针输入：请求工具 a、b → 保存 a 结果 → 保存补充 → 保存 b 未执行结果。实际投影：

```text
assistant(tool_calls=[a,b]) → tool(a) → user(补充) → tool(b)
```

处理：持久化“已排队输入”和“已交付输入”两种事件；在安全边界补齐本轮全部调用结果，再交付补充，保证同一输入只交付一次。RunInput 仍需统一支持图片、附件；当前 `useChatActions.ts:337` 仍拒绝运行中图片。

### A4 · P0：结果未知在继续时丢失，重新生成可能重复操作

- 新增 `tool_call_started` 是有用的持久化边界，但 `ConversationEventLog.ts:126` 直接忽略它。探针输入 requested + started、没有 output 时，`renderForModel('tool_role')` 实际返回 `[]`。不能由此判断旧操作没执行。
- `AgentLoopRunner.ts:191` 继续仅投影旧事件，没有识别未结束调用并要求用户核对。旧引用注册表也没有恢复。
- `src/hooks/useChatActions.ts:918` 重新生成截断到原用户消息；`:958` 只有停止场景带旧运行 ID。正常回答的重新生成仍可重新调用工具，缺少“只重新回答”的执行限制和已完成副作用背景。

处理：先重建调用状态，未知副作用进入核对界面；继续创建关联新运行，重新生成保留旧结果且不重做副作用。

### K1 · P1（核心目标未实现）：仍是三套正文存储，没有文档级 DocumentChunk

`src-tauri/src/lib/agent_runtime.rs:80` 至 `:107` 仍删除、插入 `source_blocks/retrieval_chunks/knowledge_chunks`；`DocumentIndexer.ts:187` 仍把知识库 ID 编入块 ID。同一资料加入多个知识库会重复建索引。

Rust 单事务发布已接入，但它修复的是现有三表发布，不能计作统一数据模型完成。还没有活动批次、持久化任务、删除/后台写回版本检查；删除路径仍经过前端 `executeTransaction`。

处理：完成文档级分块、批次发布、关系授权和向前迁移，接通读取/搜索/统计/删除后删除旧存储；补真实 SQLite 回滚与删除竞争测试。

### K2 · P1：附件只改为 localStorage 保存，没有进入统一索引链路

`conversationAttachmentStore.ts:194` 通过 Zustand 默认存储保存全部附件正文；八份上限已移除，但本地存储容量和同步大 JSON 写入问题未解决。`KnowledgeAdapter.ts:27` 仍用字符串包含匹配搜索附件。重启后有数据不等于 SQLite 文档关系、FTS 和后台任务闭环完成。

处理：附件复用文档导入，SQLite 保存会话关系；保存失败保留草稿；移除 localStorage 正文及附件专用检索。

### K3 · P1：引用与顺序读取还有断点

- `KnowledgeAdapter.ts:345` 把检索块 ID 写进 `sourceBlockIds`；后续 evidenceId 读取于 `:259` 用它匹配原文块 ID，导致读工具返回的引用不能继续扩展邻近内容。
- 顺序阅读只按 `source_start_block` 排序、游标是数字下标；没有版本化游标，重建后可能错位。正常存在检索块时，`page` 参数未参与该分支筛选。
- 附件按 evidenceId 读取默认从字符 0 开始，同时沿用原搜索 locator；返回文本和位置可能不一致。
- 原文块回退分支返回全文，未按读取预算限制。邻近块扩展后 locator 仍沿用旧证据，不能保证代表实际返回范围。
- `AgentLoopRunner.ts:511` 清空运行引用注册表，继续未恢复；旧工具结果中的 E 编号无法保证在新运行仍对应原文。

处理：用统一 chunk ID 与真实 locator 读取；每次交付重新登记精确范围；游标绑定批次；持久化并恢复来源映射和阅读进度。

### K4 · P1：导入仍等待 embedding，ONNX 仍静默截断，Dense 仍在 WebView

- `DocumentIndexer.ts:143` 解析前初始化 embedding，`:273` 在同一导入调用中生成语义向量。没有独立持久化语义任务的取消、失败重试和重启恢复。
- `src-tauri/src/lib/onnx_logic.rs:39` 仍配置 `with_truncation`，未对完整 searchText 用真实 tokenizer 拒绝超限。
- `src/lib/retrieval/strategies/OptimizedSQLiteVectorStore.ts:174` 将向量分批查询到前端并计算相似度，并未迁移为 Rust Top K 扫描。

处理：词法完成立即可用，语义独立排队；真实长度验证；Rust 扫描与取消；随后进行真实规模基准。

## 其他未闭环的计划项

| 项目 | 状态与依据 | 下一步 |
|---|---|---|
| 按真实端点调度全部模型请求 | 部分：Runner 的 key 仍含 model，锁住整次运行；摘要和标题未复用请求调度 | 请求级队列，同端点共享；标题低优先级 |
| 原子运行状态、完整模型回复、审批 | 部分：每个事件有 Rust 事务，但回复拆成多次 append，状态另写；审批依赖内存回调 | 同步保存相关状态和回复；审批显式持久化 |
| 完整原生协议与跨模型继续 | 部分：工具带 providerData，普通助手事件仅 content；继续直接按新模型 renderMode 重放 | 保存完整协议块；跨模型使用可移植历史 |
| 摘要检查点与分段压缩 | 未完成：ContextWindowManager 返回临时摘要；超长摘要请求直接抛错。checkpoint 表只有迁移引用 | 持久化摘要覆盖范围，分段压缩并复用 |
| 大输出附件与继续读取 | 未完成：尚无统一输出附件链路 | 将完整输出保存为文件，交付有界摘录及读取工具 |
| 进程树管理 | 部分：等待不持有取消锁已改善；Windows 用 taskkill、Unix 只 TERM 主 PID；取消忽略 kill 失败 | Job Object/进程组，确认退出，真实进程测试 |
| 统一状态与未知结果 UI | 未完成：仍以 running 布尔和 message.status 等组合判断；没有未知结果核对闭环 | 按持久化运行状态展示继续/核对入口 |
| 旧异常序号迁移 | 未完成：migration 013 直接建唯一索引，没有先处理重复序号 | 加历史异常样本及可重复升级验证 |
| 知识工具按挂载注入 | 部分：已删除历史授权恢复，但 stickyLoaded 仍可保留 knowledge 组 | 每轮按挂载过滤定义，执行时仍需检查 |

## 可确认已经落实的改进

- SSE command 改为 camelCase `requestId/proxyUrl`；后端按请求 ID 保存取消映射。
- 删除 Coding Pack `attach` 自授权路径，技能/提示词管理变更不再整体免审批。
- 当前知识库挂载持久化；工具不再从旧消息恢复知识库授权。
- 搜索引用保存实际 400 字摘录；每次 read 会生成新引用编号；PDF 使用按页提取 API。
- 索引发布与运行事件序号分配接入 Rust SQLx 事务。
- 已完成模型响应后才派发工具、顺序执行、部分落盘失败阻止后续派发，已有相关单元测试。
- tools_search 覆盖已启用 MCP 目录；删除 discover/load 入口和全局加载镜像。
- 删除伪 embedding 回退；删除附件静默保留八份的上限。

以上是局部实现验收，不能替代各自依赖的端到端、安全边界和恢复验收。

## 建议关闭问题的顺序

1. 先关闭 A1–A4：真实取消/EOF、MCP 重试与撤销、补充协议顺序、未知结果与重新生成。先补能复现缺陷的测试，再修复。
2. 完成 K1–K3：统一分块、附件关系、事务/任务版本和精确阅读引用，删除被替代数据路径。
3. 完成 K4、上下文与输出附件、运行状态及协议保存；清理剩余旧分支。
4. 运行真实 SQLite、六协议契约、桌面流程、Qwen 24×3、60 题检索与五万分块基准；记录实际值后再次验收。

完成门槛：上述阻塞项关闭且相应验证通过。当前不应将计划标记为完成，也不能把剩余工作描述成仅需人工桌面确认。
