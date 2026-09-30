# 输出上限与上下文窗口：语义收敛

日期：2026-09-24。范围：请求参数语义（不改数据库、不改协议字段）。

## 结论

这两个参数只保留"真正需要客户端决定"的部分：

| 参数 | 之前 | 现在 |
|---|---|---|
| `max_tokens`（输出上限） | 自动模式下按窗口推算一个值并下发：8K 窗口→2048、大窗口→8192 | **自动模式不下发**，交给服务端；只有用户手动设值（按窗口收敛）或关闭 |
| `context_window` | 未知时按 8192 规划：既会误判超预算让整轮失败，也会在刚聊几句时压缩历史 | 只用于**判断是否压缩历史**；**未知就不压缩、也不拦截发送** |

## 为什么去掉"自适应输出上限"

- 单次能输出多久是服务端与模型的属性，客户端推算出来的 262K 窗口→8192 只是凭空限制：模型本来可以写更长的答案。
- 反向也成立：真正 8K 窗口的模型上，替它预留输出反而挤掉输入空间。
- 协议层面只有 Anthropic 的 `max_tokens` 是必填字段，由 `AnthropicProvider` 在缺省时兜底（窗口已知取 1/8，夹在 1024–8192；未知取 8192），不伪装成用户设置。

## 为什么上下文窗口"未知就什么都不做"

- 它的唯一用途是决定历史要不要压缩（`ContextWindowManager`），不影响请求能不能发。
- 用 8192 冒充未知窗口的后果有两类，都已实际发生：正常一轮被判超预算直接失败；刚过几千 token 就把历史摘要掉。
- 现在的规则很简单：**有真实窗口才做压缩判断**；没有就原样发送，由服务端决定接不接受。窗口来源仍是"服务商上报（观察值）+ 用户手填"，取较小值。

## 相关代码

- `src/lib/llm/outputBudget.ts`：`resolveOutputBudget`（只处理用户值）、`resolveOutputReserve`（压缩时预留）。
- `src/lib/model-parameters.ts`：`applyOutputBudget` 自动模式删除 `max_tokens`，仅写 `contextWindowTokens`。
- `src/lib/mcp/pipeline/context/ContextWindowManager.ts`：窗口未知直接返回原历史。
- `src/lib/llm/providers/AnthropicProvider.ts`：必填字段兜底。
- `src/components/chat/ModelParametersDialog.tsx`：两个参数的说明文案同步更新。

## 测试

- `src/lib/llm/__tests__/outputBudget.test.ts`：任意窗口下未设用户值都不下发；用户值按窗口收敛；预留量上下限。
- `src/lib/mcp/pipeline/context/__tests__/ContextWindowManager.test.ts`：窗口未知不压缩也不失败；窗口已知时仍然压缩/报错。
- `docs/acceptance/workspace-budget.audit.test.ts`：默认（自动）不下发，且不把 8K 窗口钉成 8192。

全量：`pnpm typecheck`、`pnpm lint:ci`、`pnpm test`（71 文件 / 340 测试）通过。

## 仍然保留、需要关注的

服务端没上报窗口时，长对话不会压缩，可能最终被服务端拒绝。想让压缩行为生效，可以：
1. 让模型列表刷新一次（应用会自动记录服务商上报的窗口）；或
2. 在模型参数里手动填 Context Window。

## 历史压缩：发生方式与复用

压缩是**隐式**发生的，用户不需要操作，也没有开关：

1. 每个模型轮次开始前（`AgentRunControlPlane.assembleRoundMessages`）判断一次；
2. 前提是上下文窗口已知；触发条件是估算用量超过预算的 80%，且能找到 user 角色边界；
3. 触发后额外发一次低优先级、可随主请求取消的 LLM 请求生成摘要，然后把旧历史替换为
   `【对话历史摘要】` + 最近的完整轮次；前缀很长时按预算分段摘要；
4. 摘要写入运行检查点（`agent_run_checkpoints`，kind=`context_summary`）；
5. 任何一步失败都保留原始历史，并让本轮失败（不会静默丢约束）。

复用做了两层，都是"最不复杂"的实现：

- **同一轮内**：前缀指纹一致时直接复用检查点，不再调用模型；
- **跨轮**：运行检查点绑在 assistantMessageId 上，而每发一条消息就是新 run，所以
  之前同一段旧历史会被反复摘要。现在按会话在**进程内**缓存最近一次摘要并按需续写
  （只摘要新增的那段，把旧摘要作为【已有摘要】带入）。应用重启后退化为重新摘要一次，
  不为此加表或改结构。

可见性：本轮用上摘要时，消息上方显示一行"历史已压缩 N 条"，点开可看摘要正文
（`src/components/chat/ContextCompactionNotice.tsx`，进程内状态，不持久化）。

尚未做的（需要产品决策）：主动"立即压缩"、关闭自动压缩的开关、压缩失败时的退路
（现在等于整轮失败，历史保留）。
