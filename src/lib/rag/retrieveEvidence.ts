import { EmbeddingService } from '../embedding/EmbeddingService';
import { RetrievalService } from '../retrieval/RetrievalService';
import { EvidenceStore } from './evidenceStore';
import { buildEvidenceFromChunks } from './EvidenceBuilder';
import type { Evidence, RetrievalChunk, SourceBlock } from './evidenceTypes';
import { BM25_CANDIDATE_K, FINAL_EVIDENCE_K } from './constants';
import { DatabaseService } from '@/lib/database/services/DatabaseService';
import { LexicalRetriever } from '../retrieval/LexicalRetriever';

export class KnowledgeRetrievalError extends Error {
  constructor(
    message: string,
    public code: 'EMBEDDING_UNAVAILABLE' | 'KB_NOT_INDEXED' | 'RETRIEVAL_FAILED'
  ) {
    super(message);
    this.name = 'KnowledgeRetrievalError';
  }
}

export async function kbHasRetrievalIndex(knowledgeBaseIds: string[]): Promise<boolean> {
  const ids = knowledgeBaseIds.filter(Boolean);
  if (!ids.length) return false;
  const db = DatabaseService.getInstance().getDbManager();
  const ph = ids.map(() => '?').join(',');
  const rows = await db.select<{ n: number }>(
    `SELECT COUNT(*) as n FROM retrieval_chunks WHERE knowledge_base_id IN (${ph}) LIMIT 1`,
    ids
  );
  return Number(rows?.[0]?.n || 0) > 0;
}

export async function retrieveEvidence(params: {
  query: string;
  knowledgeBaseIds: string[];
  embeddingService: EmbeddingService;
  retrievalService: RetrievalService;
  topK?: number;
  /** Kept for API compatibility; RRF deliberately does not threshold raw scores. */
  similarityThreshold?: number;
}): Promise<{ evidence: Evidence[]; retrievalChunks: RetrievalChunk[]; mode: 'lexical' | 'hybrid' }> {
  const kbIds = params.knowledgeBaseIds.filter(Boolean);
  if (!kbIds.length) {
    return { evidence: [], retrievalChunks: [], mode: 'lexical' };
  }

  const hasIndex = await kbHasRetrievalIndex(kbIds);
  if (!hasIndex) {
    throw new KnowledgeRetrievalError(
      '知识库尚未完成索引重建，请先在知识库页面执行「重建索引」后再检索。',
      'KB_NOT_INDEXED'
    );
  }

  // 关键词索引是基础能力，不应因为 embedding 模型未安装而不可用。
  // 有可用模型时再并行加入 dense 检索；模型失败时保留 lexical 结果。
  let searchResults: Awaited<ReturnType<RetrievalService['searchByQuery']>> = [];
  let mode: 'lexical' | 'hybrid' = 'lexical';
  if (params.embeddingService.isUsableForRag()) {
    try {
      const queryEmbedding = await params.embeddingService.generateEmbedding(params.query);
      searchResults = await params.retrievalService.searchByQuery(params.query, queryEmbedding, {
        knowledgeBaseIds: kbIds,
        topK: params.topK ?? FINAL_EVIDENCE_K,
        embeddingFingerprint: params.embeddingService.getEmbeddingFingerprint() || undefined,
      });
      mode = 'hybrid';
    } catch (error) {
      console.warn('[KnowledgeRetrieval] dense retrieval unavailable; falling back to lexical:', error);
      searchResults = await new LexicalRetriever().search(params.query, {
        knowledgeBaseIds: kbIds,
        topK: BM25_CANDIDATE_K,
      });
    }
  } else {
    searchResults = await new LexicalRetriever().search(params.query, {
      knowledgeBaseIds: kbIds,
      topK: BM25_CANDIDATE_K,
    });
  }

  const chunkIds = searchResults.map((r) => r.id);
  const retrievalChunks = await EvidenceStore.getRetrievalChunks(chunkIds);
  const scoreMap = new Map(searchResults.map((r) => [r.id, r.score]));
  const chunkMap = new Map(retrievalChunks.map((c) => [c.id, c]));

  const orderedChunks: RetrievalChunk[] = [];
  for (const id of chunkIds) {
    const chunk = chunkMap.get(id);
    if (!chunk) continue;
    chunk.metadata = { ...chunk.metadata, score: scoreMap.get(id) ?? 0 };
    orderedChunks.push(chunk);
  }

  const docIds = [...new Set(orderedChunks.map((c) => c.documentId))];
  const blocks = await EvidenceStore.getSourceBlocks(docIds, kbIds);
  const blocksByDoc = new Map<string, SourceBlock[]>();
  for (const block of blocks) {
    const key = `${block.knowledgeBaseId || ''}\u0000${block.documentId}`;
    const list = blocksByDoc.get(key) || [];
    list.push(block);
    blocksByDoc.set(key, list);
  }

  const documentNames = new Map<string, string>();
  const knowledgeBaseNames = new Map<string, string>();
  for (const chunk of orderedChunks) {
    const docName = String(chunk.metadata.documentName || '');
    if (docName) documentNames.set(chunk.documentId, docName);
    if (chunk.knowledgeBaseId && chunk.metadata.knowledgeBaseName) {
      knowledgeBaseNames.set(chunk.knowledgeBaseId, String(chunk.metadata.knowledgeBaseName));
    }
  }

  try {
    const { KnowledgeService } = await import('../knowledgeService');
    const kbIdSet = new Set(orderedChunks.map((c) => c.knowledgeBaseId).filter(Boolean) as string[]);
    await Promise.all(
      [...kbIdSet].map(async (id) => {
        if (knowledgeBaseNames.has(id)) return;
        try {
          const kb = await KnowledgeService.getKnowledgeBase(id);
          if (kb?.name) knowledgeBaseNames.set(id, kb.name);
        } catch {
          /* ignore */
        }
      })
    );
  } catch {
    /* ignore */
  }

  const evidence = buildEvidenceFromChunks({
    chunks: orderedChunks,
    blocksByDoc,
    documentNames,
    knowledgeBaseNames,
    limit: params.topK ?? FINAL_EVIDENCE_K,
  });

  return { evidence, retrievalChunks: orderedChunks, mode };
}
