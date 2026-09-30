import { DatabaseService } from '@/lib/database/services/DatabaseService';
import type { RetrievalChunk } from './evidenceTypes';
import { tokenizeForFts } from '@/lib/retrieval/tokenizeForFts';
import { generateId } from '@/lib/utils/id';

/** Persistence boundary for the single document-owned chunk representation. */
export const EvidenceStore = {
  async getDocumentIndexIds(documentId: string): Promise<string[]> {
    const db = DatabaseService.getInstance().getDbManager();
    const rows = await db.select<{ id: string }>(
      `SELECT c.id FROM document_chunks c JOIN documents d ON d.active_index_batch_id = c.batch_id
        WHERE c.document_id = ? ORDER BY c.chunk_index`, [documentId],
    );
    return rows.map((row) => row.id);
  },

  async replaceDocumentIndex(params: {
    documentId: string;
    knowledgeBaseId?: string;
    chunks: RetrievalChunk[];
    expectedFileHash?: string;
    taskId: string;
    expectedDocumentVersion: number;
  }): Promise<string> {
    if (!params.chunks.length) throw new Error('文档分块为空，拒绝发布索引');
    const db = DatabaseService.getInstance().getDbManager();
    const batchId = `batch_${generateId()}`;
    const createdAt = Date.now();
    const ftsTexts = await Promise.all(params.chunks.map((chunk) => tokenizeForFts(chunk.searchText)));
    const chunks = params.chunks.map((chunk, index) => ({
      id: `chunk_${batchId}_${index}`,
      chunkIndex: index,
      sourceText: chunk.sourceText,
      searchText: chunk.searchText,
      locator: {
        page: chunk.metadata.pageStart,
        pageEnd: chunk.metadata.pageEnd,
        sectionPath: chunk.metadata.sectionPath,
        lineStart: chunk.metadata.lineStart,
        lineEnd: chunk.metadata.lineEnd,
        paragraphIndex: chunk.sourceStartBlock,
      },
      metadata: { ...chunk.metadata, sourceStartBlock: chunk.sourceStartBlock, sourceEndBlock: chunk.sourceEndBlock },
      ftsText: ftsTexts[index] || chunk.searchText,
    }));

    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('publish_document_batch', {
        db: db.getConnectionUrl(), documentId: params.documentId, batchId,
        expectedFileHash: params.expectedFileHash, taskId: params.taskId,
        expectedDocumentVersion: params.expectedDocumentVersion, chunks, createdAt,
      });
      return batchId;
    }

    // Browser tests use one in-memory connection. Production publication is
    // always the Rust command above because the SQL plugin owns a pool.
    await db.executeTransaction(async (tx) => {
      const access = await tx.select(
        `SELECT 1 FROM doc_knowledge_mappings WHERE document_id = ?
         UNION ALL SELECT 1 FROM conversation_document_mappings WHERE document_id = ? LIMIT 1`,
        [params.documentId, params.documentId],
      );
      if (!access.length) throw new Error('文档已取消挂载，取消发布索引');
      const validTask = await tx.select(`SELECT 1 FROM document_index_tasks t JOIN documents d ON d.id = t.document_id
        WHERE t.id = ? AND t.document_id = ? AND t.task_type = 'lexical' AND t.status = 'running' AND d.index_version = ?`,
      [params.taskId, params.documentId, params.expectedDocumentVersion]);
      if (!validTask.length) throw new Error('索引任务已取消或文档版本已变化');
      await tx.execute(`INSERT INTO document_index_batches (id, document_id, state, created_at)
        VALUES (?, ?, 'staging', ?)`, [batchId, params.documentId, createdAt]);
      for (const chunk of chunks) {
        await tx.execute(`INSERT INTO document_chunks
          (id, document_id, batch_id, chunk_index, source_text, search_text, locator, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [chunk.id, params.documentId, batchId, chunk.chunkIndex,
          chunk.sourceText, chunk.searchText, JSON.stringify(chunk.locator), JSON.stringify(chunk.metadata)]);
        await tx.execute('INSERT INTO document_chunks_fts (chunk_id, search_text) VALUES (?, ?)', [chunk.id, chunk.ftsText]);
      }
      await tx.execute("UPDATE document_index_batches SET state = 'retired' WHERE document_id = ? AND state = 'active'", [params.documentId]);
      await tx.execute("UPDATE document_index_batches SET state = 'active', activated_at = ? WHERE id = ?", [createdAt, batchId]);
      await tx.execute(`UPDATE documents SET active_index_batch_id = ?, index_version = index_version + 1,
        lexical_status = 'ready', semantic_status = 'pending', is_indexed = 1, updated_at = ? WHERE id = ?`,
      [batchId, createdAt, params.documentId]);
      await tx.execute("UPDATE doc_knowledge_mappings SET status = 'indexed', indexed_at = ? WHERE document_id = ?", [createdAt, params.documentId]);
      await tx.execute("UPDATE document_index_tasks SET status = 'completed', updated_at = ?, error = NULL WHERE id = ?", [createdAt, params.taskId]);
      await tx.execute(`DELETE FROM document_chunks_fts WHERE chunk_id IN (
        SELECT c.id FROM document_chunks c JOIN document_index_batches b ON b.id = c.batch_id
        WHERE b.document_id = ? AND b.state = 'retired')`, [params.documentId]);
      await tx.execute("DELETE FROM document_index_batches WHERE document_id = ? AND state = 'retired'", [params.documentId]);
    });
    return batchId;
  },

  async deleteDocumentIndex(documentId: string): Promise<string[]> {
    const db = DatabaseService.getInstance().getDbManager();
    const ids = await this.getDocumentIndexIds(documentId);
    await db.executeTransaction(async (tx) => {
      await tx.execute(`DELETE FROM document_chunks_fts WHERE chunk_id IN (
        SELECT id FROM document_chunks WHERE document_id = ?)`, [documentId]);
      await tx.execute('DELETE FROM document_index_batches WHERE document_id = ?', [documentId]);
      await tx.execute(`UPDATE documents SET active_index_batch_id = NULL, lexical_status = 'pending',
        semantic_status = 'pending', is_indexed = 0 WHERE id = ?`, [documentId]);
      await tx.execute("UPDATE doc_knowledge_mappings SET status = 'pending' WHERE document_id = ?", [documentId]);
    });
    return ids;
  },

  async getRetrievalChunks(ids: string[]): Promise<RetrievalChunk[]> {
    if (!ids.length) return [];
    const db = DatabaseService.getInstance().getDbManager();
    const rows = await db.select<any>(`SELECT c.*, d.title AS document_name, d.file_path AS document_path,
      d.file_hash AS document_hash FROM document_chunks c JOIN documents d ON d.id = c.document_id
      WHERE c.id IN (${ids.map(() => '?').join(',')}) AND d.active_index_batch_id = c.batch_id`, ids);
    return rows.map(mapChunk);
  },
};

function jsonObject(value: unknown): Record<string, any> {
  if (!value) return {};
  try { return typeof value === 'string' ? JSON.parse(value) : value as Record<string, any>; }
  catch { return {}; }
}

function mapChunk(row: any): RetrievalChunk {
  const metadata = jsonObject(row.metadata);
  const locator = jsonObject(row.locator);
  return {
    id: row.id, documentId: row.document_id,
    sourceStartBlock: Number(metadata.sourceStartBlock ?? row.chunk_index),
    sourceEndBlock: Number(metadata.sourceEndBlock ?? row.chunk_index),
    sourceText: row.source_text, searchText: row.search_text,
    metadata: { ...metadata, chunkIndex: row.chunk_index, batchId: row.batch_id,
      pageStart: locator.page, pageEnd: locator.pageEnd, sectionPath: locator.sectionPath,
      lineStart: locator.lineStart, lineEnd: locator.lineEnd, documentName: row.document_name,
      documentPath: row.document_path, documentHash: row.document_hash },
  };
}
