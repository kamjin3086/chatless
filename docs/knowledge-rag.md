# Chatless Evidence RAG v2

> 文档是唯一事实源。检索负责找到真实证据，LLM 负责阅读证据。LLM 可以选择证据，但不能创造证据。

## 原则

- `sourceText` ≠ `searchText` ≠ LLM 回答。只有解析出来的原文可被引用。
- Citation 由程序从数据库取出，模型只能输出 `[[E1]]` 这类 Evidence ID。
- 默认 Hybrid：Dense + FTS5 BM25 + RRF。没有可用 embedding 时自动降级为 FTS5。
- 本地优先：Tauri + SQLite + 现有 EmbeddingService。不引入 ES / Qdrant / Docling / GraphRAG。
- Knowledge 为可选能力：未挂知识库不注入工具；embedding 仅在索引/查询时加载。
- 没有真实 embedding 模型时仍可导入、建立关键词索引并读取原文；测试 mock 不进入生产路径。

## 数据分层

```
文件 → ParsedDocument → block（解析期内存结构）
                      → RetrievalChunk（落库：sourceText + searchText + locator）
                      → Dense + FTS5 → RRF → Evidence → LLM / Agent
```

「block」这一层今天**不落库**：`source_blocks` 表在 `src/lib/config/schema.ts` 与迁移 012 里还留着，
但全仓没有一处 INSERT / SELECT——它是上一代设计的遗留 DDL。block 只在解析器（Rust
`src-tauri/src/lib/document_structured.rs`）的内存里存在，合并后直接写进 `document_chunks`，
locator 与 chunkSchemaVersion 随 chunk 落库。看到那张空表别以为还有一层可查的事实。

- **block**：解析器实际产出 heading / paragraph / list / table / code 五类，带 locator（page / sectionPath /
  行号）。TS 的类型联合里还写着 `caption`，解析器不产它。
- **RetrievalChunk**：同一 section 的连续 block 合并，目标 500 token、上限 800
  （`src/lib/rag/constants.ts` 的 `DEFAULT_CHUNK_TARGET_TOKENS` / `DEFAULT_CHUNK_MAX_TOKENS`）；
  `searchText` = 标题 + heading path + 原文。
- **Evidence**：当前回答里的临时 ID（E1…）。落库的快照有**两份，目的不同，别混**：
  消息上的 citations 快照才是让历史引用的原文在重新索引之后仍读得回来的那份；
  `agent_delivered_evidence`（迁移 020，写入在 `src/lib/rag/evidenceSnapshots.ts`）是**按 run** 存的，
  唯一的读方要求 `child.parent_run_id = parent.id`，也就是只在续跑 / 重新生成时把已确认的
  evidence 映射带到新 run 上，跟历史消息的可读性无关。
- **chunk 与向量的关联**走 `document_chunk_embeddings.chunk_id` → `document_chunks.id`。检索那条路
  只经 `src/lib/retrieval/RetrievalService.ts`，但**它不是唯一的 join**：维护与统计另有两处
  （`src/lib/database/repositories/KnowledgeBaseRepository.ts` 的孤儿向量清理与向量统计），
  而 fingerprint + active batch 的真正过滤在 Rust 的 dense scan 里（`src-tauri/src/lib/agent_runtime.rs`），
  不在 TS 侧那段 SQL。想改筛选条件，三处都得看。
- **上一代的两张表要分开说**：`retrieval_chunks` 在 `src/lib/config/schema.ts` 与迁移 012 里，
  `vector_embeddings` 只由迁移 010 创建、不在 `schema.ts`。两者都没有检索读写方，但
  `vector_embeddings` 仍被开发期的重置工具清（`src/lib/__admin__/devTools.ts`），死掉的几份
  vector store 策略也还默认指着它。旧文档里 `vector_embeddings.id` = `retrieval_chunks.id`
  那句描述的是那张上一代表，别照着它加查询。

## 查询

普通 Chat 不强制检索。**挂载只决定一件事**：这一轮要不要注入 knowledge 工具组
（server `knowledge`，模型可见名 `knowledge__list` / `knowledge__search` / `knowledge__read`，
双下划线是 `server__tool` 约定）。检索只在模型调用这些工具时发生，没有"挂上库就自动检索"的分支。
一个 run 里知识工具最多 12 次，超了返回 `KNOWLEDGE_TOOL_BUDGET`，剩余内容就不读了
（`src/lib/mcp/agentLoop/AgentLoopRunner.ts`）。
引用在 Agent 运行结束时由程序校验并写入消息快照；证据范围失效时有 `CURSOR_INVALID` /
`EVIDENCE_NOT_FOUND` / `INDEX_NOT_READY` 三类错误码（`src/lib/mcp/pipeline/adapters/KnowledgeAdapter.ts`），
界面对它们有分支。
未挂知识库：不注入这组工具，也就不会走证据链路。

## 本版不做

Reranker、LLM Contextual Chunk、HyDE、Query Rewrite、GraphRAG、PageIndex、Docling/MinerU、更换 Vector Store、文档历史版本库。

## 什么时候算"过期"

真正参与判定的是两样：文档内容 `fileHash`（`src/lib/mcp/pipeline/adapters/KnowledgeAdapter.ts`）与 embedding 侧的
fingerprint / active batch（`src/lib/rag/evidenceStore.ts`，模型与维度都编在 fingerprint 里）。
`parserVersion` 与 `chunkSchemaVersion`（`src/lib/rag/constants.ts`）会被写到 documents 的列上、
chunk 的 metadata 里带 chunkSchemaVersion，但目前**没有地方读回它们做重建决定**（唯一的读回是 Rust 侧
自测断言）——想让解析器改动触发重建，得自己去加那条比较，别以为改了常量就自动生效。

## 实现在哪

检索 `src/lib/retrieval/`（`RetrievalService.ts` 汇总 Dense + `LexicalRetriever.ts` 的 FTS5 BM25 +
`RRFFusion.ts`，没有 embedding 时只走词法那一路）；证据与快照 `src/lib/rag/`；索引 `src/lib/indexing/`；
向量扫描在 Rust 侧 `src-tauri/src/lib/agent_runtime.rs`。跑过一轮真实评测的证据在
`docs/acceptance/`（是证据，不是规格；那里的 `*.audit.test.ts` 被 `pnpm test` 收集，
所以它们事实上兼作回归闸门——改行为时它们会红）。
