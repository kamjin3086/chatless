import { DatabaseService } from '@/lib/database/services/DatabaseService';
import type { VectorSearchResult } from './types';
import { tokenizeForFts } from './tokenizeForFts';

function buildMatchQuery(tokenized: string): string {
  const tokens = tokenized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => `"${token.replace(/"/g, '""')}"`);
  // Natural-language queries should recall any useful term. Exact identifiers
  // remain a single token and therefore still match precisely.
  return tokens.length <= 1 ? (tokens[0] || '') : `(${tokens.join(' OR ')})`;
}

export class LexicalRetriever {
  async search(queryText: string, options: {
    knowledgeBaseIds?: string[];
    topK?: number;
  } = {}): Promise<VectorSearchResult[]> {
    const topK = options.topK ?? 30;
    const tokenized = await tokenizeForFts(queryText);
    const matchQuery = buildMatchQuery(tokenized);
    if (!matchQuery) return [];

    const db = DatabaseService.getInstance().getDbManager();
    const kbIds = options.knowledgeBaseIds?.filter(Boolean) || [];

    let sql = `
      SELECT rc.id, rc.source_text as content, rc.metadata, rc.knowledge_base_id, rc.document_id,
             bm25(retrieval_chunks_fts) as rank
      FROM retrieval_chunks_fts
      JOIN retrieval_chunks rc ON rc.id = retrieval_chunks_fts.chunk_id
      WHERE retrieval_chunks_fts MATCH ?
    `;
    const params: unknown[] = [matchQuery];
    if (kbIds.length === 1) {
      sql += ` AND rc.knowledge_base_id = ?`;
      params.push(kbIds[0]);
    } else if (kbIds.length > 1) {
      sql += ` AND rc.knowledge_base_id IN (${kbIds.map(() => '?').join(',')})`;
      params.push(...kbIds);
    }
    sql += ` ORDER BY rank LIMIT ?`;
    params.push(topK);

    try {
      const rows = await db.select<any>(sql, params);
      return (rows || []).map((row: any, index: number) => {
        let metadata: Record<string, unknown> = {};
        try {
          metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {};
        } catch {
          metadata = {};
        }
        return {
          id: row.id,
          content: row.content,
          score: 1 / (index + 1),
          metadata: {
            ...metadata,
            knowledgeBaseId: row.knowledge_base_id,
            documentId: row.document_id,
          },
        };
      });
    } catch (error) {
      console.error('[LexicalRetriever] FTS search failed:', error);
      throw new Error('关键词检索不可用，请重建知识库索引后重试');
    }
  }
}
