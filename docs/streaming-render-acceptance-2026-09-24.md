# 流式文本渲染：定点优化实施记录

日期：2026-09-24。范围：流式渲染的性能与层级收敛（不改数据库结构、不改消息持久化格式）。

## 结论

计划中的定点优化已全部落地，**确定性门槛全部通过**；**真实帧数据未能在本次环境采集**，
原因与复现命令见文末。

## 根因（改动前）

1. `ContentAppender.append` 每个 chunk 调一次 `updateMessageContentInMemory` → store `set`
   → `conversations` 数组换新 → `src/app/chat/page.tsx`（selector 返回会话对象）与
   `ChatLayout`（订阅整个 `state.conversations`）每 chunk 各重渲染一次。
2. 同一份内容还有第二条写入路径：FSM `flushAll` 每帧再写一次 store 并改 `conv.updated_at`，
   `ConversationItem`（memo 比较 `updated_at`）因此每帧失效。
3. 流式期间叠加两层节流：store 的 rAF + `StreamingContentBuffer`（16–100ms 对数曲线）。
4. 若干每帧全量文本处理，以及一处返回值未被使用的工具调用解析。
5. 代码块在流式期间每新增一行触发一次 shiki 高亮（明暗两套，长块 O(n²)）。

## 改动

| 阶段 | 改动 | 位置 |
|---|---|---|
| 1 | 正文改为 appender 本地累积，每 200 字符或显式 `flush()` 才写 store+DB | `src/lib/chat/stream/ContentAppender.ts` |
| 1 | 流式 flush 不再写 `conv.updated_at`，`STREAM_END` 写一次 | `src/store/chatStore.ts` |
| 1 | 完成前先 flush 正文缓冲，保证最终 content 与卡片标记判断读到最新值 | `src/lib/chat/stream/StreamOrchestrator.ts` |
| 2 | 删除 `StreamingContentBuffer`，只保留 store 的每帧一次更新 | `src/components/chat/StreamingMarkdown.tsx` |
| 2 | `ThinkingBar` 去掉自己的 rAF 与二次节流 | `src/components/chat/ThinkingBar.tsx` |
| 2 | `AIMessageBlock` 删除未使用的解析与 think 调试 effect；`hasToolCallEarly` 只在流式期间计算 | `src/components/chat/AIMessageBlock.tsx` |
| 3 | `StreamingMarkdown` 与 `MemoizedMarkdown` 合并为单一组件（保留 `sizeOverride`） | `src/components/chat/StreamingMarkdown.tsx` |
| 3 | 删除手写 `stabilizeStreamingMarkdown`（未闭合标记交给 streamdown 自带的 remend 处理） | 同上 |
| 4 | 流式期间把"未闭合代码块"切出，用同款排版的纯文本块渲染；闭合后交给 streamdown 一次性高亮 | `src/components/chat/streamTextPrep.ts` |
| 4 | 流式期间 `controls={false}` | `StreamingMarkdown.tsx` |
| 5 | 删除死代码：`StreamTokenizer`、`MessageUpdateManager`、`MessageAutoSaver`、`MessageStreamParser`、`MessageParseCache`+`Message.tsx`、`AnimatedCharFade` | 各文件 |
| 5 | `chatStore` 中 `require('@/lib/chat/messageFsm')` 改为静态 import | `src/store/chatStore.ts` |
| 0/6 | 新增 dev-only 探针与固定夹具：`__chatlessPerf.runFixture()` | `src/lib/perf/streamingProbe.ts`、`streamFixture.ts` |

## 与计划的偏差（附实测依据）

1. **不做增量预处理**。实测 `preprocessMarkdownForSafeRender` 在 5.6KB 文本上为
   **0.233–0.288 ms/op**（约一帧预算的 1.4%），`splitTextAndToolJson` 为 **0.003 ms/op**。
   增量改写会让安全函数的状态机变复杂却换不到可感知收益，因此保留全量实现，
   只给 `splitTextAndToolJson` 加了"无围栏直接返回"的快速路径。
2. **屏障事件不额外 flush**。正文落 store 的时机＝200 字符阈值 + 流结束/出错时的 flush；
   卡片标记与最终正文都由完成路径的 flush 保证。这样正文只有一个写入者，避免多处竞争。
3. **未删除 `StreamEventDispatcher` / `ToolCardService`**：它们已无生产调用方，但不在本计划清单内，留待单独清理。

## 实测与门槛

**确定性回归（进 CI，`pnpm test`）**

- `src/lib/chat/stream/__tests__/ContentEventHandler.test.ts`
  - 单 chunk 后 store 正文仍为空（正文不再每 token 落盘），appender 缓冲持有内容；
  - `flush()` 后才写入 store，且只写一次；
  - 50 个 chunk × 50 字符（2500 字符）时 store 写入 ≤ `ceil(2500/200)+1`，且 < 50。
- `src/store/__tests__/streamingFlush.test.ts`
  - 连续两帧 `TOKEN_APPEND`：segments 更新，但 `conv.updated_at` 保持不变；
  - `STREAM_END`：`updated_at` 更新一次。
- `src/components/chat/__tests__/streamTextPrep.test.ts`
  - 未闭合代码块切分、闭合块不切分、未知语言回退 `text`、控制标签转义、`<br>` 转换。

**微基准（本机，Node 24 / 16GB / i5-9400，5.6KB 混合文本）**

| 项 | 结果 |
|---|---|
| `preprocessMarkdownForSafeRender` | 0.233–0.288 ms/op |
| `splitTextAndToolJson` | 0.003 ms/op |

**全量检查**

```powershell
pnpm typecheck   # 通过
pnpm lint:ci     # 通过（无 warning）
pnpm test        # 71 文件 / 336 测试通过
```

## 未采集：真实帧数据

计划里的量化门槛（长任务 0、帧间隔 P95 ≤ 20ms、首字上屏 ≤ 1 帧）需要真实 WebView 运行。
本次尝试时发现：本机已有正在运行的 Chatless 开发实例占用 `localhost:3000` 与同一应用数据
目录（`com.kamjin.chatless`）。为避免打断该实例、并避免把夹具消息写进正在使用的数据库，
本轮没有在真实窗口里采集帧数据。

复现方式（会插入一条夹具助手消息，测完自动删除；仅开发模式可用）：

```powershell
$env:NEXT_PUBLIC_STREAM_PERF_AUTORUN="1"; pnpm tauri dev
```

约 2.5 秒后自动跑夹具，结束后把结果写到
`%APPDATA%\com.kamjin.chatless\chatless-stream-perf.json`。
也可以在开发窗口控制台手动执行 `await __chatlessPerf.runFixture()`。

输出字段：`storeWrites`/`storeWritesPerSecond`（`conversations` 引用变化次数）、
`longTasks`/`longestTaskMs`（>50ms 主线程任务）、`frameP50Ms`/`frameP95Ms`、
`firstContentFrameMs`（首字上屏）、`chunksPerSecond`。

判定：出现 >50ms 长任务、或帧间隔 P95 >20ms、或首字上屏 >1 帧、或 store 写入仍 ≥1 次/帧，
则按计划进入结构性改造（流式状态移出 `conversations`）。

## 观感回归（待人工确认）

中文长回答、含 40 行代码块、表格、思考链、工具卡片各跑一遍，确认无闪烁、跳行、引用错位。
其中"未闭合代码块改为纯文本、闭合后再高亮"是本轮唯一有意的视觉变化：流式期间没有语法着色，
代码块闭合后一次性着色。
