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
- **RetrievalChunk**：同一 section 连续 block 合并约 400–600 token；`searchText` = 标题 + heading path + 原文。
- **Evidence**：当前回答中的临时 ID（E1…），不单独建表。`vector_embeddings.id` = `retrieval_chunks.id`。

## 查询

普通 Chat 不强制检索。挂载知识库或会话附件后，消息自动进入 Agent，使用
`knowledge_list` / `knowledge_search` / `knowledge_read`，可多轮读取；引用在 Agent
运行结束时由程序校验并写入消息快照。
未挂知识库：普通 Chat / Agent，不走证据链路。

## 本版不做

Reranker、LLM Contextual Chunk、HyDE、Query Rewrite、GraphRAG、PageIndex、Docling/MinerU、更换 Vector Store、文档历史版本库。

## 版本字段

文档变化或下列字段变化需重建索引：`fileHash`、`parserVersion`、`chunkSchemaVersion`、embedding 模型/维度。
