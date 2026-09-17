import { DatabaseService } from '@/lib/database/services/DatabaseService';
import type { RetrievalChunk, SourceBlock } from './evidenceTypes';
import { sha256Hex } from '@/lib/utils/sha256';
import { tokenizeForFts } from '@/lib/retrieval/tokenizeForFts';

export const EvidenceStore = {
  async getDocumentIndexIds(documentId: string, knowledgeBaseId?: string): Promise<string[]> {
    const db = DatabaseService.getInstance().getDbManager();
    const rows = knowledgeBaseId
      ? await db.select<{ id: string }>(
          `SELECT id FROM retrieval_chunks WHERE document_id = ? AND knowledge_base_id = ?`,
          [documentId, knowledgeBaseId],
        )
      : await db.select<{ id: string }>(
          `SELECT id FROM retrieval_chunks WHERE document_id = ?`,
          [documentId],
        );
    return (rows || []).map((row) => row.id);
  },

  async replaceDocumentIndex(params: {
    documentId: string;
    knowledgeBaseId: string;
    blocks: SourceBlock[];
    chunks: RetrievalChunk[];
  }): Promise<void> {
    const db = DatabaseService.getInstance().getDbManager();
    const ftsTexts = await Promise.all(params.chunks.map((c) => tokenizeForFts(c.searchText)));
    const contentHashes = await Promise.all(params.chunks.map((c) => sha256Hex(c.sourceText)));
    const createdAt = Date.now();
    // The SQL plugin uses a connection pool. A WebView-side transaction cannot
    // guarantee that BEGIN, the writes, and COMMIT reach one connection, so
    // desktop publication is a single Rust SQLx transaction.
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('publish_document_index', {
        db: db.getConnectionUrl(),
        documentId: params.documentId,
        knowledgeBaseId: params.knowledgeBaseId,
        createdAt,
        blocks: params.blocks.map((block) => ({
          id: block.id,
          blockIndex: block.blockIndex,
          type: block.type,
          text: block.text,
          page: block.page,
          sectionPath: block.sectionPath,
          lineStart: block.lineStart,
          lineEnd: block.lineEnd,
          charStart: block.charStart,
          charEnd: block.charEnd,
          metadata: block.metadata || {},
        })),
        chunks: params.chunks.map((chunk, index) => ({
          id: chunk.id,
          sourceStartBlock: chunk.sourceStartBlock,
          sourceEndBlock: chunk.sourceEndBlock,
          sourceText: chunk.sourceText,
          searchText: chunk.searchText,
          metadata: chunk.metadata || {},
          contentHash: contentHashes[index],
          chunkIndex: chunk.metadata.chunkIndex ?? index,
          ftsText: ftsTexts[index] || chunk.searchText,
        })),
      });
      return;
    }
    await db.executeTransaction(async (tx) => {
      const mapping = await tx.select(
        `SELECT id FROM doc_knowledge_mappings
          WHERE document_id = ? AND knowledge_base_id = ?
          LIMIT 1`,
        [params.documentId, params.knowledgeBaseId],
      );
      if (!mapping.length) {
        throw new Error('知识库文档关系已移除，取消发布索引');
      }
      await tx.execute(
        `DELETE FROM retrieval_chunks_fts WHERE chunk_id IN (SELECT id FROM retrieval_chunks WHERE document_id = ? AND knowledge_base_id = ?)`,
        [params.documentId, params.knowledgeBaseId]
      );
      await tx.execute(
        `DELETE FROM retrieval_chunks WHERE document_id = ? AND knowledge_base_id = ?`,
        [params.documentId, params.knowledgeBaseId]
      );
      await tx.execute(
        `DELETE FROM source_blocks WHERE document_id = ? AND knowledge_base_id = ?`,
        [params.documentId, params.knowledgeBaseId]
      );
      await tx.execute(
        `DELETE FROM knowledge_chunks WHERE document_id = ? AND knowledge_base_id = ?`,
        [params.documentId, params.knowledgeBaseId]
      );

      for (const block of params.blocks) {
        await tx.execute(
          `INSERT INTO source_blocks (
            id, document_id, knowledge_base_id, block_index, block_type, text, page, section_path,
            line_start, line_end, char_start, char_end, metadata, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            block.id,
            params.documentId,
            params.knowledgeBaseId,
            block.blockIndex,
            block.type,
            block.text,
            block.page ?? null,
            block.sectionPath ? JSON.stringify(block.sectionPath) : null,
            block.lineStart ?? null,
            block.lineEnd ?? null,
            block.charStart ?? null,
            block.charEnd ?? null,
            JSON.stringify(block.metadata || {}),
            createdAt,
          ]
        );
      }

      for (let index = 0; index < params.chunks.length; index += 1) {
        const chunk = params.chunks[index];
        await tx.execute(
          `INSERT INTO retrieval_chunks (
            id, document_id, knowledge_base_id, source_start_block, source_end_block,
            source_text, search_text, metadata, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            chunk.id,
            params.documentId,
            params.knowledgeBaseId,
            chunk.sourceStartBlock,
            chunk.sourceEndBlock,
            chunk.sourceText,
            chunk.searchText,
            JSON.stringify(chunk.metadata || {}),
            createdAt,
          ]
        );
        await tx.execute(
          `INSERT INTO knowledge_chunks (
            id, knowledge_base_id, document_id, content, chunk_index, content_hash, metadata, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            chunk.id,
            params.knowledgeBaseId,
            params.documentId,
            chunk.sourceText,
            chunk.metadata.chunkIndex ?? 0,
            contentHashes[index],
            JSON.stringify(chunk.metadata || {}),
            createdAt,
          ]
        );
        const ftsText = ftsTexts[index] || chunk.searchText;
        await tx.execute(
          `INSERT INTO retrieval_chunks_fts (chunk_id, search_text) VALUES (?, ?)`,
          [chunk.id, ftsText]
        );
      }
    });
  },

  async deleteDocumentIndex(documentId: string, knowledgeBaseId?: string): Promise<string[]> {
    const db = DatabaseService.getInstance().getDbManager();
    const chunkIds = await this.getDocumentIndexIds(documentId, knowledgeBaseId);
    await db.executeTransaction(async (tx) => {
      if (chunkIds.length) {
        const ph = chunkIds.map(() => '?').join(',');
        await tx.execute(`DELETE FROM retrieval_chunks_fts WHERE chunk_id IN (${ph})`, chunkIds);
      }
      if (knowledgeBaseId) {
        await tx.execute(`DELETE FROM retrieval_chunks WHERE document_id = ? AND knowledge_base_id = ?`, [documentId, knowledgeBaseId]);
        await tx.execute(`DELETE FROM source_blocks WHERE document_id = ? AND knowledge_base_id = ?`, [documentId, knowledgeBaseId]);
        await tx.execute(`DELETE FROM knowledge_chunks WHERE document_id = ? AND knowledge_base_id = ?`, [documentId, knowledgeBaseId]);
      } else {
        await tx.execute(`DELETE FROM retrieval_chunks WHERE document_id = ?`, [documentId]);
        await tx.execute(`DELETE FROM source_blocks WHERE document_id = ?`, [documentId]);
        await tx.execute(`DELETE FROM knowledge_chunks WHERE document_id = ?`, [documentId]);
      }
    });
    return chunkIds;
  },

  async getSourceBlocks(documentIds: string[], knowledgeBaseIds?: string[]): Promise<SourceBlock[]> {
    if (documentIds.length === 0) return [];
    const db = DatabaseService.getInstance().getDbManager();
    const ph = documentIds.map(() => '?').join(',');
    let sql = `SELECT * FROM source_blocks WHERE document_id IN (${ph})`;
    const params: unknown[] = [...documentIds];
    const kbIds = knowledgeBaseIds?.filter(Boolean) || [];
    if (kbIds.length) {
      sql += ` AND knowledge_base_id IN (${kbIds.map(() => '?').join(',')})`;
      params.push(...kbIds);
    }
    sql += ' ORDER BY document_id, block_index';
    const rows = await db.select<any>(sql, params);
    return (rows || []).map(mapBlock);
  },

  async getRetrievalChunks(ids: string[]): Promise<RetrievalChunk[]> {
    if (ids.length === 0) return [];
    const db = DatabaseService.getInstance().getDbManager();
    const ph = ids.map(() => '?').join(',');
    const rows = await db.select<any>(
      `SELECT * FROM retrieval_chunks WHERE id IN (${ph})`,
      ids
    );
    return (rows || []).map(mapChunk);
  },
};

function mapBlock(row: any): SourceBlock {
  let sectionPath: string[] | undefined;
  try {
    sectionPath = row.section_path ? JSON.parse(row.section_path) : undefined;
  } catch {
    sectionPath = undefined;
  }
  return {
    id: row.id,
    documentId: row.document_id,
    knowledgeBaseId: row.knowledge_base_id ?? undefined,
    blockIndex: row.block_index,
    type: row.block_type,
    text: row.text,
    page: row.page ?? undefined,
    sectionPath,
    lineStart: row.line_start ?? undefined,
    lineEnd: row.line_end ?? undefined,
    charStart: row.char_start ?? undefined,
    charEnd: row.char_end ?? undefined,
  };
}

function mapChunk(row: any): RetrievalChunk {
  let metadata: RetrievalChunk['metadata'] = {};
  try {
    metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {};
  } catch {
    metadata = {};
  }
  return {
    id: row.id,
    documentId: row.document_id,
    knowledgeBaseId: row.knowledge_base_id,
    sourceStartBlock: row.source_start_block,
    sourceEndBlock: row.source_end_block,
    sourceText: row.source_text,
    searchText: row.search_text,
    metadata,
  };
}
