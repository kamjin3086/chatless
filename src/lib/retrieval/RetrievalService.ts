import type { VectorSearchResult } from './types';
import { LexicalRetriever } from './LexicalRetriever';
import { reciprocalRankFusion } from './RRFFusion';
import { BM25_CANDIDATE_K, DENSE_CANDIDATE_K, FINAL_EVIDENCE_K, RRF_OUTPUT_K, RRF_RANK_CONSTANT } from '@/lib/rag/constants';
import { DatabaseService } from '@/lib/database/services/DatabaseService';

/** The sole retrieval facade for document-owned chunks. */
export class RetrievalService {
  async searchByQuery(queryText: string, queryEmbedding: number[], options: {
    knowledgeBaseIds?: string[]; documentIds?: string[]; topK?: number; embeddingFingerprint?: string; requestId?: string;
  } = {}): Promise<VectorSearchResult[]> {
    const kbIds = options.knowledgeBaseIds?.filter(Boolean);
    const [denseResults, lexicalResults] = await Promise.all([
      this.searchDense(queryEmbedding, kbIds, options.documentIds, options.embeddingFingerprint, DENSE_CANDIDATE_K, options.requestId),
      new LexicalRetriever().search(queryText, { knowledgeBaseIds: kbIds, documentIds: options.documentIds, topK: BM25_CANDIDATE_K }),
    ]);
    const fused = reciprocalRankFusion([denseResults, lexicalResults], RRF_RANK_CONSTANT);
    return fused.slice(0, RRF_OUTPUT_K).slice(0, options.topK ?? FINAL_EVIDENCE_K).map((item) => ({
      id: item.id, content: (item as VectorSearchResult).content, score: item.rrfScore,
      metadata: (item as VectorSearchResult).metadata,
    }));
  }

  private async searchDense(queryEmbedding: number[], knowledgeBaseIds: string[] | undefined,
    explicitDocumentIds: string[] | undefined, fingerprint: string | undefined,
    topK: number, requestId?: string): Promise<VectorSearchResult[]> {
    if (!fingerprint || !queryEmbedding.length) return [];
    const db = DatabaseService.getInstance().getDbManager();
    const ids = new Set((explicitDocumentIds || []).filter(Boolean));
    if (knowledgeBaseIds?.length) {
      const rows = await db.select<{ document_id: string }>(`SELECT document_id FROM doc_knowledge_mappings
        WHERE knowledge_base_id IN (${knowledgeBaseIds.map(() => '?').join(',')})`, knowledgeBaseIds);
      rows.forEach((row) => ids.add(row.document_id));
    }
    if (!ids.size) return [];
    const { invoke } = await import('@tauri-apps/api/core');
    const denseRequestId = requestId || `dense_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const hits = await invoke<Array<{ chunkId: string; score: number }>>('dense_search_document_chunks', {
      db: db.getConnectionUrl(), requestId: denseRequestId, queryEmbedding, documentIds: [...ids], fingerprint, topK,
    });
    if (!hits.length) return [];
    const chunks = await db.select<any>(`SELECT id, source_text, document_id, metadata FROM document_chunks
      WHERE id IN (${hits.map(() => '?').join(',')})`, hits.map((hit) => hit.chunkId));
    const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    return hits.flatMap((hit) => {
      const chunk = byId.get(hit.chunkId);
      if (!chunk) return [];
      let metadata: Record<string, unknown> = {};
      try { metadata = JSON.parse(chunk.metadata || '{}'); } catch { /* empty */ }
      return [{ id: hit.chunkId, content: chunk.source_text, score: hit.score,
        metadata: { ...metadata, documentId: chunk.document_id } }];
    });
  }
}
