# Agent 与知识库最终计划复验

日期：2026-09-21。基线：`cd6a7d5` 及当前工作区实际文件。开始时 Git 报告 6 个已跟踪文件有工作区变化；本次不覆盖这些文件、不改生产实现。审计新增可复现探针并更正旧验收结论。

**结论：不通过计划完成验收。问题包含尚未接通的实现和权限可靠性缺陷，不能只归因于缺少环境。**

用户已确认：本轮 Windows＋指定 Qwen 完整实测；其他平台、Provider 保留准确的契约测试状态。由实现方建立可复现中英文标准题集，再逐步加入真实使用样本。遗留数据兼容不参与验收。

## 本次实际验证

| 命令或检查 | 实际结果 | 能证明什么 |
|---|---|---|
| `pnpm typecheck` | 通过 | 当前生产 TypeScript 可编译 |
| `pnpm lint:ci` | 通过 | 当前 Lint 无警告错误 |
| `pnpm test` | 49 文件、209 测试通过 | 现有回归通过；不覆盖下列关键缺口 |
| `cargo test --lib`（src-tauri） | 16 测试通过 | 包括 5 个真实 SQLite 事务用例；没有覆盖审批恢复、真实进程树、Dense 基准 |
| `pnpm exec vitest run --config docs/acceptance/vitest.config.ts` | **6 项均失败** | 计划约定行为与实际行为不一致 |
| 原生桌面 / 真实 Qwen / 性能效果 | 本次未重测 | 不把 9 月 18 日的启动、协议小样本及 SQL 微基准当作本次端到端完成证明 |

探针源码：[final-plan.audit.test.ts](acceptance/final-plan.audit.test.ts)。原始结果：[2026-09-21-probe-results.json](acceptance/2026-09-21-probe-results.json)。探针独立于默认回归集，保留失败断言供修复后转成常规回归，未用 `skip` 或预期失败掩盖结果。

探针使用真实业务类；知识适配器及上下文测试替换外部依赖，不能当作桌面测试。第 6 项取生产 `LexicalRetriever` 实际生成的 SQL，用 Python 标准库的真实 SQLite/FTS5 执行。

| 探针要求 | 实际失败 |
|---|---|
| 损坏游标明确拒绝 | 从文档开头重新读取，未返回 CURSOR_INVALID |
| 顺序阅读产生的引用能定位实际范围 | 第二段引用再次读取时变成第一段 |
| documentIds 缩小检索范围 | 选定文档 ID 被适配器丢弃，传给检索层的是空数组 |
| 超长已完成历史分段压缩 | 调模型前直接抛出“待压缩历史超出摘要请求预算” |
| 已登记但未开始的调用应是未执行 | 被投影为结果未知 |
| 同挂载知识库与附件能召回两边 | 两边都有 needle，实际返回 [] |

## 阻塞缺陷与直接修复方向

### P0：权限边界仍可能扩大

- `ToolExecutionPipeline.ts:539–570` 把“允许本次”转换成父目录授权，再调用 `syncFilesystemAllowlistToBackend`；该函数调用 Rust `set_allowlist`，而 `filesystem/state.rs:169–187` 会写磁盘。临时授权因此仍进入全局持久化白名单。另一个会话可在临时窗口内共享授权；崩溃可能保留它。删除 WorkDir 的恢复闭包还复用带删除权限的 `extra`。
- `filesystem/state.rs:46–92` 仅规范斜线并比较字符串前缀，没有真实路径校验，不能排除 `..`、符号链接和 junction 逃逸。这是后端授权边界缺口，不能只靠前端路径解析。
- 修复：长期目录授权与一次调用授权分别传递；后者绑定 runId/callId、规范化参数和目标，不写全局配置。Rust 校验已存在目标或最近已存在父目录的真实路径，并在派发时复查。用独立临时目录验证穿越、junction、跨会话和撤销。

### P0：恢复和重新生成缺少安全闭环

- `AgentLoopRunner.ts:467` 在进入 Pipeline 前写执行开始，审批尚未发生；等待审批崩溃也会被误判为执行结果未知。
- `ConversationEventLog.ts:125,169–188` 不使用开始事件来区分未执行和未知；探针已复现。继续仅把未知告知模型，没有持久化核对决策和执行层阻断。
- `useChatActions.ts:912–968` 重新生成截断到用户消息，并只在“继续停止任务”时传旧运行 ID。虽然 regenerate 能禁止工具，却没有旧工具结果/引用背景，也没有 regeneration 血缘。
- 启动时会将 pending 审批设为 expired（`DatabaseService.ts:95`，这一点已实现），但旧运行恢复仅处理 running，没有处理 waiting_approval。`getRunStatus` 尚无 UI 调用方，停止原因与统一运行视图未闭环。
- 修复：开始事件移到授权后、实际派发前；依据 callId 的 request/start/result 重建状态；未知副作用先经用户核对，执行层验证决策。继续、重新生成均传父运行并复用结果；重新生成保持禁工具。启动事务同时处理中断运行和失效审批。

### P0：Shell 取消和完整输出仍有缺口

- `sandbox/commands.rs:268–282` 先 spawn 再绑定 Job Object，有子进程逃出管理及绑定失败残留进程的窗口。
- `kill_process_tree` 关闭 Job handle，正常 wait 收尾又可能关闭同一 handle；句柄是可复制整数，没有单一资源所有权。终止成功后也没有完整等待整个 Job 退出的验证。
- `drain_output` 超过上限仍持续读管道，但丢弃多余字节；前端只能把已经截断的结果写成附件，无法恢复完整输出。
- `ShellExecutorAdapter` 仍包含脚本模式、转义修复和命令拆分；脚本分支没有传入运行所属 executionId。需一并收敛为显式 Shell、原样命令和统一进程管理。
- 修复：后端统一拥有进程/Job 生命周期；保证创建、绑定、取消和清理顺序。完整 stdout/stderr 边读边写运行所属文件，只给模型有界摘录；父子进程、长输出和取消用真实进程测试。

### P1：知识库＋附件范围不一致

- `KnowledgeAdapter.ts:115–118` 将 knowledgeBaseIds 与附件 documentIds 分别传入检索。
- `LexicalRetriever.ts:44–53` 将两个条件 AND；`RetrievalService.searchDense` 却取并集。无 embedding 时可直接丢光结果，有 embedding 时两路使用不同范围。
- 模型选择的知识库文档子集在 search 适配时丢失；schema 也没有声明 documentIds。
- 修复：在门面入口算出唯一 allowedDocumentIds，并与模型选择取交集；词法、Dense、list/read 全部用同一集合。空集合不能代表无限制。

### P1：引用、读取与继续阅读缺少统一范围表示

- 顺序 read 未登记 retrievalChunkId、块内 offset；引用恢复又显式使用空 sourceBlockIds，Citation 本身不保存块 ID。再次按 evidenceId 读取会退回文档开头，探针已复现。
- 邻近 read 先拼全部块再截断，却登记所有候选 chunk IDs 和首块位置，范围不精确；达到限额的页内扩展没有继续游标。
- `parseCursor` 无效输入静默变 null；读取把文档余下全部块查入 WebView 后再裁切。字符限制未与模型剩余 token 容量连接。
- 引用注册表是内存；只在运行 finally 将答案用到的 citation 存消息。崩溃前已交付但未引用的证据映射无法完整恢复。
- 引用 UI 为快照 Popover，尚无原文侧栏、相邻读取和原文件打开完整入口。
- 修复：统一 `DeliveredRange`（文档、批次、块、起止 offset、位置、hash、文本）；工具结果与证据范围一同持久化。SQL 分页读取，合法游标严格检查；历史看快照，读取当前原文复查权限。

### P1：长任务摘要和完整协议还未达标

- `ContextWindowManager.ts:43–60` 按消息条数寻找 user 边界，只一次性压缩整个前缀。旧历史超过摘要窗口直接失败；单个长工具回合也无法压缩其已完成步骤。
- 摘要只在 prefix 的长度和 hash 完全相同时复用，没有增量压缩；新运行只加载自身 checkpoint，未继承父运行检查点。
- `ConversationEventLog` 的 assistant_message 仅保存 content。普通回复原生 reasoning/内容块未完整保存；继续按新 renderMode 直接重放旧 providerData，未记录来源协议并作兼容转换。
- 摘要 `chat()` 没有传运行取消信号/请求 ID，运行停止不能保证取消摘要。Runner 与公共入口仍各承担调度部分，需要统一真实传输终态与租约释放。
- 修复：按完整模型步骤分组，分段摘要并保存覆盖事件范围；增量复用父运行摘要。模型响应整体持久化并记录协议，跨协议转可移植正文/结果。所有模型请求共用可取消句柄。

### P1：语义任务“有方法”不等于用户可用

- `SemanticIndexQueue.cancel/retry` 没有生产调用方，界面只有状态展示。无模型任务被标 failed；后续配置模型没有明确唤醒失败任务入口。
- 分块固定 800 tokens（估算），没有适配配置模型；ONNX 已禁止截断，但遇超长块会失败，重建仍沿用相同大小。当前 LocalOnnx 对单次推理错误会置整个模型 unavailable，输入超限也被混同模型故障。
- 词法发布后才独立更新 hash、parserVersion 并 enqueue 语义任务；两者之间退出会留下发布成功却无后续任务的窗口。
- Rust embedding 写入只验证当前文档/批次及任务 pending/running，没有将 task_type、task.document_version 和指纹完整绑定；模型中途切换也没有每批固定模型代次的保障。
- lexical 任务重启恢复没有实现；resume 只处理 semantic。
- 修复：发布事务包含文件版本和后续任务；队列有 waiting_model、pending、running、failed/cancelled/completed 等明确状态及 UI 调用方。真实 tokenizer 适配完整 searchText；输入错误不卸载模型；批次固定模型代次及指纹，写回再次验证。

### P1：取消和能力刷新存在遗漏

- Dense 开始直接把 requestId 的取消标志覆盖为 false；如果先取消再开始扫描，取消会丢失。数据库错误路径也不保证清理。
- `promptBuilder.ts:409–413` 仍将 knowledge 留在 stickyLoaded；Runner 只在 tools search 后刷新定义，撤销后下一步定义不会及时消失。执行范围校验虽然能挡住越界，仍不满足已批准交互。
- 修复：请求生命周期统一管理取消标记并 finally 清理；每模型步按最新挂载和能力过滤定义，删除知识工具粘性状态。

## 为什么前次“通过”不可靠

1. 把存在表、方法、注释当成调用方已闭环，未检查 UI/恢复路径是否真正调用。
2. 现有测试以局部 mock 为主。49/209 全绿仍未覆盖组合挂载、实际审批、重启未知调用等边界；新增探针直接暴露差异。
3. 16 项 Rust 中仅 5 项业务 SQLite 测试，没有完成审批、任务、附件、删除竞争、重启矩阵。
4. Qwen 小样本只证明端点支持原生工具协议，不能证明 Chatless 运行内核能完成任务。
5. 50K 临时 Python SQLite 基准没有保存可复现 harness，语料为合成短文本，不含应用 IPC/中文分词/真实授权规模，不足以关闭原定性能验收。
6. 没有题集、基准脚本或桌面 harness 是实现方可完成的测试交付工作，不应列为特殊外部条件。

## 替代方案与后续执行顺序

不更换整个 Agent 框架、不重新设计检索架构。保留文档级表、原子发布、原生工具循环、端点队列等有效部分，逐段补齐事实边界。

| 阶段 | 工作与替代方式 | 阶段门槛 |
|---|---|---|
| 1. 权限与副作用 | 调用级一次授权替代临时全局白名单；真实路径校验；工具派发边界；未知核对；Shell 资源所有权 | 跨会话无权限扩张；junction/穿越拒绝；未知操作不派发；真实父子进程取消 ≤2 秒 |
| 2. 资料与阅读 | 唯一文档范围；严格游标；DeliveredRange；证据与进度落盘；引用面板实际入口 | 本次 6 个探针中相关项转绿；四格式、组合挂载、重建、删除、重启与引用通过 |
| 3. 长任务与队列 | 分段增量摘要、父检查点继承、完整响应协议、Shell 全输出附件；语义任务状态、长度与模型代次；统一状态 UI | 8K/32K/262K 长历史通过；取消/重启/模型切换可解释；按钮调用真实队列能力 |
| 4. 冻结验收设施 | 独立数据目录，Windows WebDriver；60 检索题与 24×3 Qwen 任务；Rust 50K 基准、资源与启动测量 | 下述验收标准实际达标并保存命令/配置/原始结果/提交 |

桌面自动化可使用 Tauri 官方支持的 `tauri-driver`＋匹配 WebView2 的 Edge WebDriver；本机 PATH 未检测到两者，仓库也没有对应 harness。先安装隔离测试依赖、验证最小点击，再扩展流程。工具接口不能控制原生窗口，不代表 Tauri 不可自动测试。若当前会话不支持交互桌面，则在 Windows CI/可交互测试机执行；人工清单是暂时替代证据，不当作自动化通过。[Tauri 官方 WebDriver 文档](https://v2.tauri.app/develop/tests/webdriver/)、[官方 CI 示例](https://v2.tauri.app/develop/tests/webdriver/ci/)。

标准题集由实现方建设：四格式确定性中英文资料、明确事实/冲突/无答案、正确文档与原文范围；每题冻结后再调检索。Qwen 任务按可验证产物评分，普通聊天、文件、知识、联网、MCP/Skills、错误、停止和补充均有固定输入与检查器。执行测试使用隔离目录，不读取用户私人资料。

Dense 不必等待额外设备或人为选择维度：先以 384/768/1024 维确定性向量调用生产 Rust 扫描做性能和正确性验证；再固定仓库已支持的本地模型验证真实 embedding 与召回。前者不计入语义质量得分。记录本机 CPU/RAM/SSD，若不满足原定 16GB 条件，结果写清硬件，另补目标设备验证。

验收门槛保留：Recall@8 ≥90%；Qwen 24×3 实际任务完成率 ≥90%；50K 词法 P95 ≤500ms、Dense＋融合 P95 ≤2s（不含 query embedding）；停止反馈 ≤200ms；子进程树取消 ≤2s；默认提示＋工具 ≤4K；冷启动 P95 回归 ≤10%。权限越界、重复副作用、协议损坏不接受豁免。

## 真正可能需要用户或外部条件的部分

- 指定 Qwen 服务如不可达/更换地址或凭据，需要恢复访问；“没有任务题集”不属于这一类。
- Windows WebDriver 如无法在当前会话建立交互桌面，需要可交互测试机/CI runner；先做实际安装启动探测再确认阻塞。
- 若要对未配置的远端 Provider 或非 Windows 平台宣称实测支持，需要相应凭据/设备；依用户本次决定不阻塞 Windows＋Qwen 的验收。
- 真实业务代表性样本可以后续加入，不能用自建题集成绩宣称覆盖所有真实工作。

无需再让用户决定是否修权限、是否补未知核对、是否做分段摘要：这些已是批准计划的必要项。本次两个范围问题已获得决策，后续可以按上述门槛实施。
