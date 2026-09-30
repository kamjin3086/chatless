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

    const kbIds = options.knowledgeBaseIds?.filter(Boolean) || [];
    const documentIds = options.documentIds?.filter(Boolean) || [];
    // An empty scope means "nothing", never "everything": retrieval must always
    // be bounded by the documents the session can actually reach.
    if (!kbIds.length && !documentIds.length) return [];

    // Knowledge-base membership and an explicit document list are two additive
    // ways of naming the same scope (library documents and session attachments).
    // Intersecting them silently dropped every attachment hit; a plain AND here
    // would also disagree with the dense path, which unions the same two sets.
    const scopeClauses: string[] = [];
    const scopeParams: unknown[] = [];
    if (kbIds.length) {
      scopeClauses.push(`EXISTS (SELECT 1 FROM doc_knowledge_mappings m
        WHERE m.document_id = dc.document_id AND m.knowledge_base_id IN (${kbIds.map(() => '?').join(',')}))`);
      scopeParams.push(...kbIds);
    }
    if (documentIds.length) {
      scopeClauses.push(`dc.document_id IN (${documentIds.map(() => '?').join(',')})`);
      scopeParams.push(...documentIds);
    }
    const scope = `(${scopeClauses.join(' OR ')})`;

    // Fast path: let FTS5 rank its own rows with the top-N priority queue and
    // apply the document scope afterwards. A correlated scope predicate inside
    // the ranked query makes SQLite score every match (~1s at 50k chunks).
    // The result is exact whenever at least `topK` in-scope rows fall inside the
    // window: anything outside the window ranks below all of them.
    const window = Math.max(topK * 8, 200);
    const fast = await this.run(`
      SELECT dc.id, dc.source_text as content, dc.metadata, dc.locator, dc.document_id, f.rank
      FROM (SELECT chunk_id, bm25(document_chunks_fts) as rank FROM document_chunks_fts
             WHERE document_chunks_fts MATCH ? ORDER BY rank LIMIT ?) f
      JOIN document_chunks dc ON dc.id = f.chunk_id
      JOIN documents d ON d.id = dc.document_id AND d.active_index_batch_id = dc.batch_id
      WHERE ${scope} ORDER BY f.rank LIMIT ?
    `, [matchQuery, window, ...scopeParams, topK]);
    if (fast.length >= topK) return fast;

    // Exact but slower: required when the scope is a small slice of a large
    // index and the candidate window was dominated by out-of-scope documents.
    return this.run(`
      SELECT dc.id, dc.source_text as content, dc.metadata, dc.locator, dc.document_id,
             bm25(document_chunks_fts) as rank
      FROM document_chunks_fts
      JOIN document_chunks dc ON dc.id = document_chunks_fts.chunk_id
      JOIN documents d ON d.id = dc.document_id AND d.active_index_batch_id = dc.batch_id
      WHERE document_chunks_fts MATCH ? AND ${scope}
      ORDER BY rank LIMIT ?
    `, [matchQuery, ...scopeParams, topK]);
  }

  private async run(sql: string, params: unknown[]): Promise<VectorSearchResult[]> {
    const db = DatabaseService.getInstance().getDbManager();
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
