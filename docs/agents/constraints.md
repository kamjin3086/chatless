# 项目约束

原 `.cursor/rules/*.mdc`，Cursor 停用后迁移到这里。改产品方向时改这里，不要在别处另写一份。

## 产品定位

Chatless 是面向重视本地隐私、模型自由与实用自动化用户的轻量桌面 AI 工作台。它连接云端
和本地模型，通过可选能力处理知识、文档、文件及少量代码任务，但不替代 IDE 或专业编码
Agent。

**身份（必须强化）**

- 本地优先、数据在本机、不要求云账号
- 多 Provider 与 OpenAI-compatible 兼容，包括 Ollama / LM Studio
- 轻量、启动快、依赖少、功能可关闭
- 实用：对话、文档、知识库、MCP、Skills、轻量 Agent
- Chat / Agent 双模式；native / prompt tool-call 双轨降级

**用户**：主用户是重视隐私和模型选择的桌面用户，以及需要本地自动化的技术型用户。专职
程序员可能使用 Chatless，但不会把它当主力 IDE Agent。专业开发者“看不上编码深度”不构成
失败。

**表达方式**：正确说法是“轻量、本地优先、兼容多种模型的通用 Agent，也能处理代码相关
任务”；错误说法是“Chatless 要替代 Cursor、Claude Code 或 Codex”。

**当前明确不做**：移动端、便携版；自研代码编辑器、补全、LSP、IDE 深度集成；默认依赖
Docker、Qdrant、常驻 sidecar；强制云后端或云账号；企业级多 Agent 编排 / swarm / A2A
作为核心能力。

## 功能准入

实现或扩大范围前，必须书面回答：

1. 服务的是核心用户，还是想象中的边缘用户？
2. 是否强化「本地、兼容、轻量、实用」中至少两项？
3. 为什么不能用 MCP、Skill 或可选包实现？
4. 关闭后能否接近零启动、内存和包体成本？
5. 真实场景和可衡量成功标准是什么？
6. 谁维护测试、安全、跨平台和兼容？

以下理由单独成立则否决：竞品有；看起来先进；模型可能会用；以后也许有需求。

**实验 → 毕业 → 退出**：先做 Labs / 实验且默认关闭 → 观察至少两个版本周期 → 看重复使用
率、任务完成率、性能成本 → 达标才进入正式能力，否则改为 Skill/MCP 或删除。

**资源比例（按里程碑，不是按热点）**：60% 核心稳定性、性能、兼容、安全；25% 主用户实用
功能；10% 可选能力包；5% 前沿实验。热点（A2A、Computer Use、swarm、Next major）不得挤压
Core。

**模块化硬约束**：可选包不得改 Core 启动路径、默认权限、默认依赖；新能力默认关闭，直到有
证据证明主路径需要它；用 feature flag 或设置项隔离，禁止“先做进主路径再考虑拆包”。

## 能力分层

新功能必须落入其中一层，无法归类则先不要做。

- **Core（默认最好，始终维护）**：多 Provider、本地模型、参数策略；本地 SQLite、隐私、
  会话与消息；稳定流式渲染、thinking 分离、长会话性能；Prompt 管理、附件、基础文件能力；
  轻量 Agent 运行内核（事件、取消、审批）；权限与审批 UX（ToolCard、allowlist）
- **官方可选包（默认零成本，关闭后接近不存在）**：Knowledge / RAG / 本地嵌入、MCP 客户端、
  Skills、WebDAV 同步、Coding Pack（项目搜索、解释、patch 预览、受控脚本）、高级自动化
  （后台任务等）
- **扩展生态（优先 MCP / Skill，不进核心）**：浏览器自动化、Computer Use、GitHub / Notion /
  数据库等第三方服务、远程 Agent、A2A、专业办公或垂直工作流
- **禁止进入产品身份**：代码编辑器、补全、云沙箱、自动 PR；默认扫描整机或默认开放
  Desktop/Documents/Downloads；为“看起来先进”引入的框架（LangGraph、云端 Agent SDK、
  微服务、RSC 重构）

Coding Pack 证明通用 Agent 能处理代码，不是 Chatless 的身份。

## Harness 演进

Chatless 已有 Agent 骨架（StreamEvent、AgentLoop、Tool pipeline、MCP、Skills）。短板是未
收口为可持久化控制平面。演进原则：渐进接线，禁止推倒重来。

**必须保留**：Chat / Agent 双模式；native + prompt tool-call 双轨，兼容 Ollama / LM Studio /
老旧 compatible 端点；本地优先（Tauri + SQLite + 可选本地 embedding）；ToolCard 审批、
filesystem allowlist、停止/取消；现有 Skills（SKILL.md）资产，现代化应兼容而非替换；多
Provider 策略委派与参数修正。

**优先收口（P0/P1），不要另起炉灶**：持久化 AgentRun / 事件日志，历史从事件投影而不只靠
`message.content`；把已有 `ConversationEventLog`、`ContextWindowManager`、
`PromptEnvelopeBuilder` 接到主路径；统一 AgentLoop 与旧 `ToolCallOrchestrator` 的重复逻辑；
per-run 取消与解析器状态，先队列隔离再谈并行；Provider 能力协商（tools、usage、structured
output、continuation），缺能力则降级。

**禁止**：引入 LangGraph / 云端 Agent SDK / 微服务作为核心运行时；单 Agent 还不能恢复、
审计、取消时就做 swarm / subagent 平台；用重写 UI 框架或 RSC 来“现代化 harness”；破坏
compatible 回退路径去对齐某一家最新 API。

Subagent、Worktree、A2A、Computer Use 都是可选 adapter，且排在单 Agent 可恢复之后。

## Coding Pack

适用于 `src/lib/mcp/**`、`src/lib/skills/**`、`src/lib/agentWorkspace/**`、
`src/lib/filesystem*/**`、`src-tauri/src/filesystem/**`、`src-tauri/src/sandbox/**`。

允许 Chatless 处理代码相关任务，证明通用 Agent 实用；不允许与 Cursor / Claude Code / Codex
正面竞争。

**允许（可选、需授权、默认可关）**：会话显式 `project__attach`，不默认扫描整机；递归 glob /
grep、分段读取、路径别名；解释代码、日志、配置；`apply_patch` + diff 预览，写入前审批；
只读 git status/diff/log，写操作按风险分级、禁止默认 force；受控运行 lint / test / 脚本并
结构化结果；只读注入 `AGENTS.md` 等项目说明。

**禁止**：内置编辑器、补全、LSP、云沙箱、自动 PR、多 Agent 编码编排；把搜索/修改/验证全部
塞进不受限 `shell__run`；扩大默认 FS/HTTP/Opener 权限来“方便编码”；未授权工作区、未审批
写入、未确认的破坏性 git/shell；让普通聊天用户承担 Git worktree 或并行写仓库的复杂度。

**验证方式**：先做只读理解 + 小修改预览，用挂载率、复用率、任务完成率决定是否加深。需求弱
就维持可选；需求强也只加深 Pack，不改产品身份。实现时复用现有 allowlist、ToolCard、审批和
`@WorkDir`，不要平行再做一套权限模型。

## 质量预算

保持轻量、兼容、高性能。数字回归时，功能让路或降为可选包。

**性能与体积**：Core 安装包增幅控制在约 10–15% 内，不把 ONNX 大模型打进默认安装包；冷启动
P95 回归 < 10%，测两套（无 MCP/RAG，以及全功能）；流式首 token 不因审计/日志层明显变慢；
可选服务（MCP、ORT、远程目录）不得阻塞首屏。

**正确性**：禁止用模拟 embedding 冒充本地 RAG，模型不可用就明确禁用；Chat 模式与 prompt
tool fallback 必须保持可用；测试必须真实收集并失败即失败，禁止 `MODULE_NOT_FOUND` 被吞掉仍
绿；不把 CI / lint / 签名校验设为 `continue-on-error`。

**安全（纵深，但不为安全牺牲兼容）**：工具副作用走运行时策略，不靠模型自律；收紧 CSP 与
HTTP/FS/Opener 默认范围，用户授权目录另开；Shell 以工作区 + 审批 + 尽量白名单为主，不只靠
危险命令黑名单；Trace/日志默认不含 prompt、tool args、文件内容。

**兼容**：保留 Ollama、LM Studio、OpenAI-compatible、无 tools 端点；依赖升级按兼容矩阵整组
进行，不追 latest，Next major 不与 Harness 绑定；禁止未 pin 的 git `branch = main` 依赖进入
发布路径；不引入 Redux、RSC 全面服务端化、next-intl、Qdrant 必选后端等重型方案。
