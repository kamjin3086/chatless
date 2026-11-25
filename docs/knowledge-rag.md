# Chatless Evidence RAG v2

> 文档是唯一事实源。检索负责找到真实证据，LLM 负责阅读证据。LLM 可以选择证据，但不能创造证据。

## 原则

- `sourceText` ≠ `searchText` ≠ LLM 回答。只有 SourceBlock 原文可被引用。
- Citation 由程序从数据库取出，模型只能输出 `[[E1]]` 这类 Evidence ID。
- 默认 Hybrid：Dense + FTS5 BM25 + RRF。没有可用 embedding 时自动降级为 FTS5。
- 本地优先：Tauri + SQLite + 现有 EmbeddingService。不引入 ES / Qdrant / Docling / GraphRAG。
- Knowledge 为可选能力：未挂知识库不注入工具；embedding 仅在索引/查询时加载。
- 没有真实 embedding 模型时仍可导入、建立关键词索引并读取原文；测试 mock 不进入生产路径。

## 数据分层

```
文件 → ParsedDocument → SourceBlock（事实）
                      → RetrievalChunk（搜索：sourceText + searchText）
                      → Dense + FTS5 → RRF → Evidence → LLM / Agent
```

- **SourceBlock**：heading / paragraph / list / table / code / caption，带 locator（page / sectionPath / 行号）。
- **RetrievalChunk**：同一 section 的连续 block 合并，目标 500 token、上限 800
  （`src/lib/rag/constants.ts` 的 `DEFAULT_CHUNK_TARGET_TOKENS` / `DEFAULT_CHUNK_MAX_TOKENS`）；
  `searchText` = 标题 + heading path + 原文。
- **Evidence**：当前回答里的临时 ID（E1…）。它不是"什么都不落库"——回答用过的证据会被快照进
  `agent_delivered_evidence`（迁移 020，写入在 `src/lib/rag/evidenceSnapshots.ts`），为的是历史消息
  的引用在重新索引之后仍然指得回当时的原文。
- **chunk 与向量的关联**走 `document_chunk_embeddings.chunk_id` → `document_chunks.id`，并按 embedding
  fingerprint 与索引批次（active batch）筛，`src/lib/retrieval/RetrievalService.ts` 是唯一读法。旧文档里
  `vector_embeddings.id` = `retrieval_chunks.id` 那句描述的是上一代表：两张表在 `schema.ts` 与迁移 012
  里还留着，但没有活的读写方，别照着它加查询。

## 查询

普通 Chat 不强制检索。挂载知识库或会话附件后，消息自动进入 Agent，使用
`knowledge_list` / `knowledge_search` / `knowledge_read`，可多轮读取；引用在 Agent
运行结束时由程序校验并写入消息快照。
未挂知识库：普通 Chat / Agent，不走证据链路。

## 本版不做

Reranker、LLM Contextual Chunk、HyDE、Query Rewrite、GraphRAG、PageIndex、Docling/MinerU、更换 Vector Store、文档历史版本库。

## 什么时候算"过期"

真正参与判定的是两样：文档内容 `fileHash`（`src/lib/mcp/pipeline/adapters/KnowledgeAdapter.ts`）与 embedding 侧的
fingerprint / active batch（`src/lib/rag/evidenceStore.ts`，模型与维度都编在 fingerprint 里）。
`parserVersion` 与 `chunkSchemaVersion`（`src/lib/rag/constants.ts`）目前只是**记录**在 chunk 上，
全仓没有读回它们做重建决定的地方——想让解析器改动触发重建，得自己去加那条比较，别以为改了常量就自动生效。

## 实现在哪

检索 `src/lib/retrieval/`（`RetrievalService.ts` 汇总 Dense + `LexicalRetriever.ts` 的 FTS5 BM25 +
`RRFFusion.ts`，没有 embedding 时只走词法那一路）；证据与快照 `src/lib/rag/`；索引 `src/lib/indexing/`；
向量扫描在 Rust 侧 `src-tauri/src/lib/agent_runtime.rs`。跑过一轮真实评测的证据在
`docs/acceptance/`（是证据，不是规格）。
