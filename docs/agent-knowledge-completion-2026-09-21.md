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

### 检索评测集

- `docs/acceptance/retrieval-cases.json`：7 份中英文资料、26 个分块，覆盖 PDF / Markdown / DOCX / TXT 四种来源，其中一份为会话附件；63 道题包含中文短词、型号与错误码、数字、跨分块核对、资料冲突、无答案和双语查询，每题标注正确原文分块。
- `docs/acceptance/generate-retrieval-cases.py` 生成题集；`cargo test --lib generate_retrieval_token_fixture -- --ignored` 用生产 jieba 分词器生成 `retrieval-tokens.json`；`python docs/acceptance/build-eval-db.py` 构建真实 SQLite；评测直接调用生产 `LexicalRetriever`，因此被测 SQL 就是产品 SQL。
- 分词行为已验证：中文按词切分（`过载保护与熔断器更换` → 过载/保护/…），标识符在连字符处切分（`E-1042` → `E`/`-`/`1042`），索引与查询使用同一分词器。
- 报告写入 `docs/acceptance/retrieval-eval-report.json`。

### 性能评测说明

基准使用文件型 SQLite（WAL）与生产语句形状，包含 bm25 排序、活动批次连接与范围过滤。它**不包含**前端 IPC、结果渲染与查询 embedding 推理；`Dense＋融合 P95 ≤2s` 仍未测量，属于下方缺口。

## 3. 仍未完成，需继续验收

以下项本轮没有做到，不作为“已完成”声明：

1. **Qwen 24×3 任务集与完成率 ≥90%**：本轮只完成了用户确认的“先建立可复现标准题集”这一步（检索题集）。已实际探测配置中的端点 `http://101.37.152.90:6434/`，`/v1/models` 与根路径都返回 **HTTP 502**，因此现在无法建立 24 个固定任务的实测记录。恢复端点后需建立任务集并各运行 3 次。
2. **真实桌面端流程**：Tauri WebDriver 与 WebView2 驱动未安装，未验证发送、补充、停止、拒绝审批、重启继续、重新生成、大输出等流程。人工清单不能替代自动化证据。
3. **Dense＋融合 P95 ≤2s 与五万分块向量扫描**：本轮只测量词法路径；向量路径无 embedding 模型与对应规模数据可用。
4. **跨平台**：本轮验收范围为 Windows；其他平台仅保持既有契约测试状态。
5. **真实使用样本**：检索题集为自建标准集，尚不包含真实业务样本。

## 4. 完成定义

只有上述第 1–3 项关闭、第 4–5 项按已确认范围记录后，才满足此前批准计划的完成标准。本轮交付的是可复现的质量与性能基线、以及复验中可闭环缺陷的修复，不是“体验已达标”的结论。
