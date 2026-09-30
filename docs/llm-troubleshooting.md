# LLM 排查手册

## 回复答非所问 / “你的消息好像没发完”

先确认模型到底收到了什么，不要猜。

1. **先看数据库**（应用侧唯一完整的记录）：
   `~/Library/Application Support/com.kamjin.chatless/mychat.db`

   ```sql
   -- 你发的原文是否完整
   select role, content, length(content) from messages order by created_at desc limit 6;

   -- 模型的思考原文（segments）—— 含 chat template 控制符时一眼可见
   select json_extract(segments, '$[0].text') from messages where id = '<assistant message id>';

   -- 这一轮模型上下文里到底有什么
   select event_type, payload from agent_run_events where conversation_id = '<id>' order by seq;
   ```

   `agent_run_events` 里的 `user_message` 就是送进模型的内容。如果它和你输入的一致，问题就不在“消息被截断”。

2. **打开请求体日志**：设置 → 高级设置 → 日志级别 → **调试**。
   该级别会把 OpenAI-compatible 请求体 dump 到
   `~/Library/Logs/com.kamjin.chatless/logs.log`（`[llm-debug] request ...`），
   同时日志级别本身会持久化，重启后仍然生效。

3. **看 `[llm] upstream model emitted a chat-template turn boundary` 警告**。
   出现它说明上游把模型的**原始 chat template 输出**当成正文返回了：模型在自己吐出
   ` <|im_end|>` 之后继续“自导自演”下一轮对话，客户端把这段续写丢掉了（保留边界之前的内容）。
   常见原因是自建服务端（llama.cpp / vLLM / 网关）的 chat template 与模型不匹配，
   或请求没有下发 `stop`。

## Chat template 控制符的处理

- 流式（`src/lib/llm/providers/thinking/turnBoundary.ts`）：
  在 `ThinkingStrategyFactory` 创建策略时统一包裹一层守卫，命中 `<|im_end|>`、`<|eot_id|>`、
  `<|end_of_turn|>`、`<|endoftext|>`、`<|end▁of▁sentence|>`（以及已有正文时的 `<|im_start|>`）
  即结束本轮，之后的所有 delta 直接丢弃；跨 chunk 切分的 token 也能匹配。
- 显示与持久化（`src/lib/llm/chatTemplateTokens.ts` + `mcp/toolInstruction/filter.ts`）：
  只清理控制符本身（含紧随其后的角色词），不截断内容——历史数据里无法区分“模型续写”和
  “用户主动粘贴的模板”，所以截断只发生在流式路径。
- OpenAI-compatible 请求在调用方没有配置 `stop` 时，会默认下发
  `['<|im_end|>', '<|eot_id|>', '<|end_of_turn|>', '<|endoftext|>']`，让服务端直接停下。
  官方 `openai` provider 不下发：部分推理模型会因 `stop` 参数返回 400。

GPT-OSS 的 harmony 标签（`<|start|>`、`<|end|>`、`<|channel|>`、`<|message|>`）是 App 有意解析的
文本工具调用格式，不在这套控制符里。
