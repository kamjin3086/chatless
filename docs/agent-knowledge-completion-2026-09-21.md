# Agent 与知识库收尾：本轮实际完成与剩余验收

日期：2026-09-21。基线：`cd6a7d5` 与 [最终复验](agent-knowledge-final-audit-2026-09-21.md) 中列出的阻塞缺陷。

本轮补齐了复验中可闭环的部分，并首次建立了可复现的检索质量与性能评测。**仍未宣称计划完成**：剩余缺口在本文件最后一节逐条列出，其中 Qwen 任务集与真实桌面流程尚未执行。

## 1. 已完成的修复

| 复验中的问题 | 处理方式 | 证据 |
|---|---|---|
| 一次授权写进全局 allowlist，可被其他会话共享 | 「允许本次」改为 Rust 内存中的调用级授权，绑定 run/call，执行结束即撤销；持久白名单只保留用户设置 | `filesystem/state.rs`、`ToolExecutionPipeline.ts`、[toolApprovalScope.test.ts](../src/lib/mcp/pipeline/__tests__/toolApprovalScope.test.ts) 断言授权不落入持久白名单 |
| 后端只做字符串前缀比较，未校验真实路径 | 归一化折叠 `..`，并用 `canonicalize` 解析符号链接/junction 后同时比较字面路径与真实路径；删除授权绑定到目标本身而非父目录 | `filesystem/state.rs` 单测：穿越被拒、verbatim 前缀等价、junction 逃逸被拒 |
| 顺序阅读的游标无效时静默从头读取 | 游标严格解析，格式/文档/批次不匹配一律返回 `CURSOR_INVALID` | 探针 1（现为回归） |
| 引用重新打开落回文档开头 | 引用登记实际交付范围 `DeliveredRange`（文档、批次、分块、起止偏移），按范围重开 | 探针 2（现为回归） |
| 模型选择的知识库子集在检索入口丢失 | 门面先算出唯一 allowed 文档集合（知识库 ∪ 附件）再与模型选择取交集，词法/Dense/list/read 共用 | 探针 3、6（现为回归） |
| 知识库与附件两路范围不一致，无 embedding 时结果为 0 | `LexicalRetriever` 将两个来源视为并集，空集合不再代表“无限制” | 探针 6 在真实 SQLite 上验证 |
| 超长历史无法压缩，直接抛错 | 压缩按完整模型步骤分段，滚动摘要并在预算内合并 | 探针 4（现为回归） |
| 已登记未开始的调用被报成“结果未知” | 无执行开始事件 → `not_executed`；有开始无结果 → `unknown` | 探针 5（现为回归） |
| Shell 先 spawn 后建 Job，绑定失败或子进程逃逸 | Job Object 先创建、再 spawn、再绑定；绑定失败立即杀进程；Job 句柄单一所有权；取消后 2 秒内确认进程退出 | 真实进程测试 `terminates_a_real_process_tree_within_two_seconds` |
| 超时终止失败时提前 return，残留注册项可误杀复用的 pid | 终止失败也走统一结果路径并清理注册表 | `sandbox/commands.rs` |
| Dense 扫描把已有取消标志覆盖为 false | 扫描前先检查取消，标志只在缺失时插入，所有退出路径都清理注册项 | `agent_runtime.rs` |
| 撤销挂载后知识工具仍因粘性状态出现 | `knowledge` 组不再粘性，每轮按当前挂载实时计算 | `promptBuilder.ts` |
| 断电/重启后 `waiting_approval` 运行永久悬挂 | 启动恢复同时把 `running` 与 `waiting_approval` 标记为 `interrupted` | `AgentRunEventStore.ts` |
| 无模型时语义任务被标记失败，配置模型后无入口 | 新增 `waiting_model` 状态、`wakeWaiting()` 与按文档的重试/取消，知识库文档行提供操作入口 | `SemanticIndexQueue.ts`、`KnowledgeDetail.tsx`、`ResourceItem.tsx` |
| 重新生成没有血缘，也没有旧工具结果背景 | 记录 `parentRunId` 与 `run_kind = regeneration`；把上一次运行的工具结果作为事实背景注入到用户回合之前，回答本身不重放，工具保持禁用 | `AgentLoopRunner.ts`、[AgentLoopRunner.test.ts](../src/lib/mcp/agentLoop/__tests__/AgentLoopRunner.test.ts) |
| 检索性能：50k 分块上词法 P95 约 1 秒 | 范围谓词移出排序查询，先让 FTS5 用 top-N 取候选再过滤；窗口内 in-scope 行数不足 `topK` 时回退到精确定义查询 | 下方性能表格 |

## 2. 本轮实际测量

命令与结果都可复现，全部在本机 Windows 环境执行。

| 检查 | 命令 | 实际结果 |
|---|---|---|
| 类型与静态检查 | `pnpm typecheck` / `pnpm lint:ci` | 通过 |
| 前端回归 | `pnpm test` | 50 文件、212 测试通过 |
| Rust 单元与真实进程测试 | `cargo test --lib` | 20 通过、2 ignored（评测生成器与 50k 基准不会在常规测试中运行） |
| 计划边界探针 | `pnpm exec vitest run --config docs/acceptance/vitest.config.ts` | 6/6 通过（复验时为 6/6 失败） |
| 检索质量 | 同上（含 63 题） | **Recall@8 = 100%**，63 题全部命中标注原文，4 道无答案题返回空 |
| 50k 分块词法性能 | `cargo test --lib lexical_query_latency_on_50k_chunks -- --ignored --nocapture` | **P50 11.0 ms / P95 87.2 ms / max 88.8 ms**（57 次查询，50,000 分块，库 29.5 MiB，构建 13.6s）；同一基准确认旧查询形状 P95 972 ms |
| Agent 任务完成率（Qwen） | `CHATLESS_QWEN=1 pnpm exec vitest run --config docs/acceptance/vitest.config.ts docs/acceptance/qwen-acceptance.audit.test.ts` | **98.6%（71/72）**，24 个固定任务各 3 次；权限越界与重复副作用 0 次；默认提示＋工具 ≈1965 tokens，挂载知识库时 ≈2544 tokens |

### Qwen Agent 任务验收

范围：`Qwen3.8-Flash-Next-medium`，端点 `http://10.126.126.2:8101`，24 个固定任务（普通对话、文件读写与列举、Shell、知识库检索与无答案、跨步汇总、运行中更正、失败恢复、越权读写、破坏性操作拒绝）× 3 次。

系统提示与工具定义直接取自生产模块（`AGENT_MINIMAL_SYSTEM_PROMPT`、`toolRegistry` 的工具组、`PromptEnvelopeBuilder` 排序），工具执行与循环属于测试夹具。**它衡量“模型＋Chatless 提示＋Chatless 工具契约”，不衡量应用运行时**：流式渲染、持久化、审批卡片、恢复仍由单元测试与桌面验收覆盖。

结果：完成率 98.6%，越权与重复副作用 0 次。唯一失败样本是 `chat-math` 第 2 次运行返回**空回答**（0 步、无工具调用），符合 thinking 模型在固定 `max_tokens` 下把预算耗在推理上的表现；报告已记录 `finishReason` 与 `reasoningChars` 供后续诊断。这是真实观察到的行为，不是评分口径问题，已列为后续项。

本轮先在夹具上发现并修掉了两个缺陷，再取得上述数字：

1. 模型按应用约定使用 `@WorkDir/...` 别名，而夹具最初把它当成字面目录名，导致文件类任务假失败（第一次完整运行只有 40.3%）。改为调用生产的 `resolveAllowlistPath` 后恢复正常。
2. 知识库任务最初没有向模型**声明** knowledge 工具，模型正确地报告“知识库中没有该信息”。改为按应用行为在挂载资料时提供 knowledge 工具后通过。

两次诊断都保留了原始失败记录与回答，用于区分“夹具缺陷”和“模型能力”。相关探针：`docs/acceptance/qwen-acceptance.audit.test.ts`，报告：`docs/acceptance/qwen-acceptance-report.json`。

### 检索评测集

- `docs/acceptance/retrieval-cases.json`：7 份中英文资料、26 个分块，覆盖 PDF / Markdown / DOCX / TXT 四种来源，其中一份为会话附件；63 道题包含中文短词、型号与错误码、数字、跨分块核对、资料冲突、无答案和双语查询，每题标注正确原文分块。
- `docs/acceptance/generate-retrieval-cases.py` 生成题集；`cargo test --lib generate_retrieval_token_fixture -- --ignored` 用生产 jieba 分词器生成 `retrieval-tokens.json`；`python docs/acceptance/build-eval-db.py` 构建真实 SQLite；评测直接调用生产 `LexicalRetriever`，因此被测 SQL 就是产品 SQL。
- 分词行为已验证：中文按词切分（`过载保护与熔断器更换` → 过载/保护/…），标识符在连字符处切分（`E-1042` → `E`/`-`/`1042`），索引与查询使用同一分词器。
- 报告写入 `docs/acceptance/retrieval-eval-report.json`。

### 性能评测说明

基准使用文件型 SQLite（WAL）与生产语句形状，包含 bm25 排序、活动批次连接与范围过滤。它**不包含**前端 IPC、结果渲染与查询 embedding 推理；`Dense＋融合 P95 ≤2s` 仍未测量，属于下方缺口。

## 3. 仍未完成，需继续验收

以下项本轮没有做到，不作为“已完成”声明：

1. **真实桌面端流程**：Tauri WebDriver 与 WebView2 驱动未安装，未验证发送、补充、停止、拒绝审批、重启继续、重新生成、大输出等流程。人工清单不能替代自动化证据。任务完成率已在夹具上达标，但应用运行时未在真实桌面复测。
2. **Dense＋融合 P95 ≤2s 与五万分块向量扫描**：本轮只测量词法路径；向量路径无 embedding 模型与对应规模数据可用。
3. **空回答的可见性与处理**：Qwen 任务集中观察到 1/72 次返回空回答（thinking 预算耗尽）。需要确认应用侧是否应把“无内容且无工具调用”的终态标记出来并提供重试，而不是显示空气泡。
4. **任务夹具与真实运行时的差距**：任务完成率来自测试夹具循环；结论只覆盖模型、提示与工具契约，不能替代应用运行时的桌面验收。
5. **跨平台**：本轮验收范围为 Windows；其他平台仅保持既有契约测试状态。
6. **真实使用样本**：检索题集为自建标准集，尚不包含真实业务样本。

## 4. 完成定义

只有上述第 1–4 项关闭、第 5–6 项按已确认范围记录后，才满足此前批准的完成标准。本轮交付的是可复现的质量与性能基线、复验中可闭环缺陷的修复，以及首次达标的 Agent 任务完成率，不是“体验已达标”的结论。
