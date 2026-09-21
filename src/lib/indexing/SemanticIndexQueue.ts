import { DatabaseService } from '@/lib/database/services/DatabaseService';
import { getRAGService } from '@/lib/rag/ragServiceInstance';
import { generateId } from '@/lib/utils/id';

type PendingTask = { id: string; document_id: string; document_version: number };

/**
 * Distinct from a real failure: the document is fine, only the embedding model
 * is missing. Keeping it out of `failed` means configuring a model later can
 * pick the work up instead of leaving the document permanently unavailable.
 */
class EmbeddingModelUnavailableError extends Error {}

class SemanticIndexQueue {
  private running = false;

  async enqueue(documentId: string): Promise<string> {
    const db = DatabaseService.getInstance().getDbManager();
    const docs = await db.select<{ index_version: number }>('SELECT index_version FROM documents WHERE id = ?', [documentId]);
    if (!docs.length) throw new Error('文档已删除');
    const id = `semantic_${generateId()}`;
    const now = Date.now();
    await db.execute(`INSERT INTO document_index_tasks
      (id, document_id, document_version, task_type, status, created_at, updated_at)
      VALUES (?, ?, ?, 'semantic', 'pending', ?, ?)`, [id, documentId, docs[0].index_version, now, now]);
    void this.drain();
    return id;
  }

  async resume(): Promise<void> {
    const db = DatabaseService.getInstance().getDbManager();
    await db.execute("UPDATE document_index_tasks SET status = 'pending', updated_at = ? WHERE task_type = 'semantic' AND status IN ('running', 'waiting_model')", [Date.now()]);
    void this.drain();
  }

  /** Called when the embedding configuration changes: retry everything that was waiting for a model. */
  async wakeWaiting(): Promise<void> {
    const db = DatabaseService.getInstance().getDbManager();
    await db.execute("UPDATE document_index_tasks SET status = 'pending', error = NULL, updated_at = ? WHERE task_type = 'semantic' AND status = 'waiting_model'", [Date.now()]);
    void this.drain();
  }

  async cancel(taskId: string): Promise<boolean> {
    const db = DatabaseService.getInstance().getDbManager();
    const result = await db.execute(
      "UPDATE document_index_tasks SET status = 'cancelled', updated_at = ? WHERE id = ? AND task_type = 'semantic' AND status IN ('pending','running')",
      [Date.now(), taskId],
    );
    if (result.rowsAffected) await db.execute(`UPDATE documents SET semantic_status = 'pending'
      WHERE id = (SELECT document_id FROM document_index_tasks WHERE id = ?)`, [taskId]);
    return Boolean(result.rowsAffected);
  }

  async retry(taskId: string): Promise<boolean> {
    const result = await DatabaseService.getInstance().getDbManager().execute(
      "UPDATE document_index_tasks SET status = 'pending', error = NULL, updated_at = ? WHERE id = ? AND task_type = 'semantic' AND status IN ('failed','cancelled')",
      [Date.now(), taskId],
    );
    if (result.rowsAffected) void this.drain();
    return Boolean(result.rowsAffected);
  }

  /** Cancel whatever semantic work a document currently has queued or running. */
  async cancelForDocument(documentId: string): Promise<boolean> {
    const db = DatabaseService.getInstance().getDbManager();
    const result = await db.execute(
      "UPDATE document_index_tasks SET status = 'cancelled', updated_at = ? WHERE document_id = ? AND task_type = 'semantic' AND status IN ('pending','running','waiting_model')",
      [Date.now(), documentId],
    );
    if (result.rowsAffected) {
      await db.execute("UPDATE documents SET semantic_status = 'pending' WHERE id = ?", [documentId]);
    }
    return Boolean(result.rowsAffected);
  }

  /** Requeue a document whose semantic index failed, was cancelled, or waited for a model. */
  async retryForDocument(documentId: string): Promise<boolean> {
    const db = DatabaseService.getInstance().getDbManager();
    const result = await db.execute(
      "UPDATE document_index_tasks SET status = 'pending', error = NULL, updated_at = ? WHERE document_id = ? AND task_type = 'semantic' AND status IN ('failed','cancelled','waiting_model')",
      [Date.now(), documentId],
    );
    if (result.rowsAffected) void this.drain();
    return Boolean(result.rowsAffected);
  }

  private async drain(): Promise<void> {
    if (this.running || typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    this.running = true;
    try {
      const db = DatabaseService.getInstance().getDbManager();
      while (true) {
        const tasks = await db.select<PendingTask>(`SELECT id, document_id, document_version FROM document_index_tasks
          WHERE task_type = 'semantic' AND status = 'pending' ORDER BY created_at LIMIT 1`);
        if (!tasks.length) break;
        await this.process(tasks[0]).catch(async (error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (error instanceof EmbeddingModelUnavailableError) {
            // Waiting for a model is not a failure: keep the lexical index
            // usable and leave the task discoverable.
            await db.execute(
              "UPDATE document_index_tasks SET status = 'waiting_model', error = ?, updated_at = ? WHERE id = ? AND status = 'running'",
              [message, Date.now(), tasks[0].id],
            );
            await db.execute("UPDATE documents SET semantic_status = 'pending' WHERE id = ? AND index_version = ?", [tasks[0].document_id, tasks[0].document_version]);
            return;
          }
          const failed = await db.execute(
            "UPDATE document_index_tasks SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status = 'running'",
            [message, Date.now(), tasks[0].id],
          );
          // Cancellation owns the document status. A late embedding rejection
          // must not overwrite the pending state written by cancel().
          if (failed.rowsAffected) {
            await db.execute("UPDATE documents SET semantic_status = 'failed' WHERE id = ? AND index_version = ?", [tasks[0].document_id, tasks[0].document_version]);
          }
        });
      }
    } finally { this.running = false; }
  }

  private async process(task: PendingTask): Promise<void> {
    const db = DatabaseService.getInstance().getDbManager();
    const claimed = await db.execute("UPDATE document_index_tasks SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'", [Date.now(), task.id]);
    if (!claimed.rowsAffected) return;
    await db.execute("UPDATE documents SET semantic_status = 'processing' WHERE id = ? AND index_version = ?", [task.document_id, task.document_version]);
    const docs = await db.select<{ active_index_batch_id: string; index_version: number }>(
      'SELECT active_index_batch_id, index_version FROM documents WHERE id = ?', [task.document_id]);
    if (!docs.length || docs[0].index_version !== task.document_version || !docs[0].active_index_batch_id) {
      throw new Error('文档版本已变化');
    }
    const batchId = docs[0].active_index_batch_id;
    const chunks = await db.select<{ id: string; search_text: string }>(
      'SELECT id, search_text FROM document_chunks WHERE document_id = ? AND batch_id = ? ORDER BY chunk_index',
      [task.document_id, batchId]);
    const rag = await getRAGService();
    const embedding = rag.getEmbeddingService();
    if (!embedding.isUsableForRag()) throw new EmbeddingModelUnavailableError('未配置可用的 embedding 模型');
    const fingerprint = embedding.getEmbeddingFingerprint();
    if (!fingerprint) throw new Error('embedding 模型指纹不可用');
    const batchSize = 16;
    const { invoke } = await import('@tauri-apps/api/core');
    for (let index = 0; index < chunks.length; index += batchSize) {
      const status = await db.select<{ status: string }>('SELECT status FROM document_index_tasks WHERE id = ?', [task.id]);
      if (status[0]?.status === 'cancelled') throw new Error('语义索引任务已取消');
      const batch = chunks.slice(index, index + batchSize);
      const generated = await embedding.generateEmbeddings(batch.map((chunk) => chunk.search_text));
      const vectors = batch.map((chunk, offset) => ({ chunkId: chunk.id, embedding: generated[offset] }));
      await invoke('store_document_embeddings', { db: db.getConnectionUrl(), taskId: task.id,
        documentId: task.document_id, batchId, documentVersion: task.document_version,
        fingerprint, embeddings: vectors, replaceExisting: index === 0,
        complete: index + batch.length >= chunks.length, createdAt: Date.now() });
    }
  }
}

export const semanticIndexQueue = new SemanticIndexQueue();
