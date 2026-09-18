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
    documentIds?: string[];
    topK?: number;
  } = {}): Promise<VectorSearchResult[]> {
    const topK = options.topK ?? 30;
    const tokenized = await tokenizeForFts(queryText);
    const matchQuery = buildMatchQuery(tokenized);
    if (!matchQuery) return [];

    const db = DatabaseService.getInstance().getDbManager();
    const kbIds = options.knowledgeBaseIds?.filter(Boolean) || [];

    let sql = `
      SELECT dc.id, dc.source_text as content, dc.metadata, dc.locator, dc.document_id,
             bm25(document_chunks_fts) as rank
      FROM document_chunks_fts
      JOIN document_chunks dc ON dc.id = document_chunks_fts.chunk_id
      JOIN documents d ON d.id = dc.document_id AND d.active_index_batch_id = dc.batch_id
      WHERE document_chunks_fts MATCH ?
    `;
    const params: unknown[] = [matchQuery];
    if (kbIds.length) {
      sql += ` AND EXISTS (SELECT 1 FROM doc_knowledge_mappings m
        WHERE m.document_id = dc.document_id AND m.knowledge_base_id IN (${kbIds.map(() => '?').join(',')}))`;
      params.push(...kbIds);
    }
    const documentIds = options.documentIds?.filter(Boolean) || [];
    if (documentIds.length) {
      sql += ` AND dc.document_id IN (${documentIds.map(() => '?').join(',')})`;
      params.push(...documentIds);
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
            documentId: row.document_id,
            locator: typeof row.locator === 'string' ? JSON.parse(row.locator || '{}') : row.locator,
          },
        };
      });
    } catch (error) {
      console.error('[LexicalRetriever] FTS search failed:', error);
      throw new Error('关键词检索不可用，请重建知识库索引后重试');
    }
  }
}
