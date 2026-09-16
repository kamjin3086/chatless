# Agent 模式 vs Chat 模式：工具续写路径对照

> M3 设计门结论：**差异超过 3 处用户可感知行为，本轮不合并循环**，仅共享 EventLog（已实现）。以下供后续是否抽取 `resumeRound` 时参考。

## 路径概览

| 维度 | Agent (`AgentLoopRunner`) | Chat (`ToolCallOrchestrator`) |
|------|---------------------------|-------------------------------|
| 循环 | `while(true)` 多轮 | `continueWithToolResult` 轻量递归 |
| 事件日志 | `AgentRunControlPlane` + SQLite | `ChatRunEventRecorder` 写同一表 |
| 发模型历史 | Envelope prefix + 事件投影 compact | `historyForLlm` + `buildToolRoleAppendix` |
| 工具注入 | `forceInject` + Envelope tools | 意图检测 + 可选 native tools |

## 用户可感知差异（>3 → 不合并）

1. **标题生成**：Agent 在整轮 Loop 结束后统一生成；Chat 可在单轮流完成后触发（`StreamOrchestrator`）。
2. **工具轮次预算**：Agent `MAX_BUDGET` 加权预算；Chat `MAX_RESUME_ROUNDS=8` + 连续空结果熔断。
3. **Stop / 取消**：Agent `AgentLoopRunner.cancel` + `agentRuns`；Chat `ToolCallCoordinator.cancelMessage` + stream cancel。
4. **模式默认**：新会话默认 `chat`；Agent 需显式切换。
5. **系统注入**：Agent 强制 MCP 注入；Chat 按意图注入，普通聊天不带 tools。

## 已共享

- `agent_run_events` 持久化（Chat / Agent 均写入）
- 启动时 `markAllStaleRunsCancelled` 清理幽灵 run
- Tool 执行管线 `ToolExecutionPipeline` + adapters

## 明确不做

- 用 `AgentLoopRunner` 替换 Chat 单轮体验
- 复活已删除的 `FollowUpDispatcher`

## 若未来合并

仅建议抽取 **只读** 共享模块（如 `buildToolRoleAppendix`、熔断计数），Chat 仍自行 `streamChat` 一次，不进入 `while(true)`。
