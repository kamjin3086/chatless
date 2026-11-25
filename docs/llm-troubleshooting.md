# LLM 排查手册

## 先看东西在哪（三个平台）

两个路径分别由 Tauri 的 app config / app log 目录决定，先看这张表再下面的命令。

| 平台 | 主数据库 `mychat.db` | 日志文件 |
|---|---|---|
| Linux | `$XDG_CONFIG_HOME/com.kamjin.chatless/`（默认 `~/.config/…`）| `$XDG_DATA_HOME/com.kamjin.chatless/logs/logs.log` |
| macOS | `~/Library/Application Support/com.kamjin.chatless/` | `~/Library/Logs/com.kamjin.chatless/logs.log` |
| Windows | `%APPDATA%\com.kamjin.chatless\` | `%LOCALAPPDATA%\com.kamjin.chatless\logs\logs.log` |

数据库落在 **config** 目录而不是 data 目录：`tauri-plugin-sql` 对相对文件名用的是
`app_config_dir()`。macOS / Windows 上 config 与 data 恰好重合，Linux 上不重合——所以别拿
`appDataDir()` 去推。本机实测：`~/.config/com.kamjin.chatless/mychat.db` 有内容，
`~/.local/share/com.kamjin.chatless/mychat.db` 是个 0 字节空文件（按 `appDataDir()` 拼出来的
假路径），照着 data 目录找库会翻到它。

日志由 `tauri-plugin-log` 写（`src-tauri/src/lib.rs` 的 `TargetKind::LogDir { file_name: "logs" }`），
文件叫 `logs.log`。上限 2 MB、轮转策略 `KeepOne`：判定只在启动打开日志文件时发生一次，不在写入时
轮转——所以一轮长会话可以超过 2 MB，但上一轮会被删掉，复现完了尽早导出。

## 回复答非所问 / “你的消息好像没发完”

先确认模型到底收到了什么，不要猜。

1. **先看数据库**（应用侧唯一完整的记录）：上表的 `mychat.db`。

   ```sql
   -- 你发的原文是否完整
   select role, content, length(content) from messages order by created_at desc limit 6;

   -- 模型的思考原文（segments）—— 含 chat template 控制符时一眼可见
   -- think 通常在首段但不保证；要稳就 json_each 配合 kind='think' 筛
   select json_extract(segments, '$[0].text') from messages where id = '<assistant message id>';

   -- 这一轮模型上下文里到底有什么（seq 只在单次 run 内有序，跨轮还要加 run_id 筛）
   select event_type, payload from agent_run_events where conversation_id = '<id>' order by seq;
   ```

   `agent_run_events` 里的 `user_message` 就是送进模型的内容。如果它和你输入的一致，问题就不在“消息被截断”。

2. **看得到请求体吗**：设置 → 高级设置 → 日志级别 → **调试**；级别会持久化，重启后仍生效
   （构建期设了 `NEXT_PUBLIC_LLM_DEBUG=true` 时无视级别直接开）。OpenAI-compatible 的请求体以
   `[llm-debug] request ...` 写出，单条在约 2 万字符处截断（`src/lib/llm/debugLog.ts`），内容含
   用户原文。它是 debug 级，而日志文件那一路建链时的分发上限是 Info（`src-tauri/src/lib.rs`），
   本机日志里一条 debug 行也没有——所以**日志里没有 `[llm-debug]` 不等于请求没发出去**，别在这儿
   下结论，接着看下一条。请求体被截断也别当成模型只收到这些：截的是 dump，不是请求。

3. **看 `[llm] upstream model emitted a chat-template turn boundary` 警告**。
   出现它说明上游把模型的**原始 chat template 输出**当成正文返回了：模型在自己吐出 `<|im_end|>` 之后继续“自导自演”下一轮对话，客户端把这段续写丢掉了（保留边界之前的内容）。
   常见原因是自建服务端（llama.cpp / vLLM / 网关）的 chat template 与模型不匹配。这条是 warn 级、
   不受调试开关影响，常发——拿它当「模型那边到底发生了什么」的靠得住信号。

## Chat template 控制符的处理

- 流式（`src/lib/llm/providers/thinking/turnBoundary.ts`）：在 `ThinkingStrategyFactory` 创建策略
  时统一包裹一层守卫，命中结束符即结束本轮，之后的所有 delta 直接丢弃；跨 chunk 切分的 token 也能
  匹配。清单在 `chatTemplateTokens.ts`：`TURN_END_TOKENS` 九个（ChatML 的 im_end、Llama 的 eot_id /
  eom_id / eot / end_of_text、Gemma 的 end_of_turn、GPT-2 与 Qwen base 的 endoftext、DeepSeek 的
  end_of_sentence 及全角写法），`TURN_OPEN_TOKENS` 两个，且只在已有正文时才当边界——改之前先读那份
  注释，每个 token 都标了它来自谁的模板。旧版本在这里只列了五个 token，漏了一半，别照它删。
- 显示与持久化（`src/lib/llm/chatTemplateTokens.ts` + `mcp/toolInstruction/filter.ts`）：
  只清理控制符本身（含紧随其后的角色词），不截断内容——历史数据里无法区分“模型续写”和
  “用户主动粘贴的模板”，所以截断只发生在流式路径。
- **现在没有任何 provider 会自行下发默认 `stop`**（`de65d80`）。OpenAI-compatible 的请求体里只有
  用户自己设了 `stopSequences` 才出现 `stop`：用户没设过的采样参数不该由 App 替他编。边界仍然在流
  里切（`providers/thinking/turnBoundary.ts`），这才是「续写不会显示」的原因。旧文档说 OpenAI
  compatible 会默认下发四个 token、官方 `openai` 不下发——那段已经过期。

GPT-OSS 的 harmony 标签（`start`、`end`、`channel`、`message`、`constrain`、`call`、`return` 七个，
外面各套上尖括号与竖线）是 App 有意解析的文本工具调用格式，不在这套控制符里。
