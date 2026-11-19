import { DatabaseService } from '@/lib/database/services/DatabaseService';
import { withRAGService, refreshRAGService, getRAGService } from '@/lib/rag/ragServiceInstance';
import { generateId } from '@/lib/utils/id';
import { EmbeddingInputError } from '@/lib/embedding/types';
import type { EmbeddingTextBudget } from './embeddingBudget';

type PendingTask = { id: string; document_id: string; document_version: number; task_type: 'lexical' | 'semantic' };

/**
 * Distinct from a real failure: the document is fine, only the embedding model
 * is missing. Keeping it out of `failed` means configuring a model later can
 * pick the work up instead of leaving the document permanently unavailable.
 */
class EmbeddingModelUnavailableError extends Error {}
class EmbeddingModelChangedError extends Error {}

export class SemanticIndexQueue {
  private running = false;
  private revision = 0;
  private listeners = new Set<(documentId?: string) => void>();

  getRevision(): number { return this.revision; }
  subscribe(listener: (documentId?: string) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private changed(documentId?: string) {
    this.revision++;
    for (const listener of this.listeners) {
      try { listener(documentId); } catch (error) { console.warn('[SemanticIndexQueue] Progress listener failed:', error); }
    }
  }

  async enqueue(documentId: string): Promise<string> {
    const db = DatabaseService.getInstance().getDbManager();
    const docs = await db.select<{ index_version: number }>('SELECT index_version FROM documents WHERE id = ?', [documentId]);
    if (!docs.length) throw new Error('文档已删除');
    const id = `semantic_${generateId()}`;
    const now = Date.now();
    await db.execute(`INSERT OR IGNORE INTO document_index_tasks
      (id, document_id, document_version, task_type, status, created_at, updated_at)
      VALUES (?, ?, ?, 'semantic', 'pending', ?, ?)`, [id, documentId, docs[0].index_version, now, now]);
    void this.drain();
    const active = await db.select<{ id: string }>("SELECT id FROM document_index_tasks WHERE document_id = ? AND document_version = ? AND task_type = 'semantic' ORDER BY created_at DESC, rowid DESC LIMIT 1", [documentId, docs[0].index_version]);
    if (!active[0]) throw new Error('Semantic job was not persisted');
    return active[0].id;
  }

  async resume(): Promise<void> {
    const db = DatabaseService.getInstance().getDbManager();
    await db.execute("UPDATE document_index_tasks SET status = 'pending', updated_at = ? WHERE status = 'running' OR (task_type = 'semantic' AND status = 'waiting_model')", [Date.now()]);
    await db.execute("INSERT OR IGNORE INTO document_index_tasks (id, document_id, document_version, task_type, status, created_at, updated_at) SELECT 'semantic_' || lower(hex(randomblob(16))), d.id, d.index_version, 'semantic', 'pending', ?, ? FROM documents d WHERE d.active_index_batch_id IS NOT NULL AND d.semantic_status != 'ready' AND NOT EXISTS (SELECT 1 FROM document_index_tasks t WHERE t.document_id = d.id AND t.document_version = d.index_version AND t.task_type = 'semantic')", [Date.now(), Date.now()]);
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      const indexed = await db.select('SELECT 1 FROM documents WHERE active_index_batch_id IS NOT NULL LIMIT 1');
      if (indexed.length) void getRAGService().then((service) =>
        this.wakeWaiting(service.getEmbeddingService().getEmbeddingFingerprint() || undefined)
      ).catch((error) => console.warn('[SemanticIndexQueue] Startup model reconciliation failed:', error));
    }
    void this.drain();
  }

  /** Called when the embedding configuration changes: retry everything that was waiting for a model. */
  async wakeWaiting(fingerprint?: string): Promise<void> {
    const db = DatabaseService.getInstance().getDbManager();
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('prepare_semantic_indexing', { db: db.getConnectionUrl(), fingerprint: fingerprint || null, updatedAt: Date.now() });
    } else await db.execute("UPDATE document_index_tasks SET status = 'pending', error = NULL, updated_at = ? WHERE task_type = 'semantic' AND status = 'waiting_model'", [Date.now()]);
    this.changed();
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
    await refreshRAGService();
    const result = await DatabaseService.getInstance().getDbManager().execute(
      "UPDATE document_index_tasks SET status = 'pending', error = NULL, updated_at = ? WHERE id = ? AND task_type = 'semantic' AND status IN ('failed','cancelled') AND document_version = (SELECT index_version FROM documents WHERE id = document_index_tasks.document_id) AND NOT EXISTS (SELECT 1 FROM document_index_tasks active WHERE active.document_id = document_index_tasks.document_id AND active.document_version = document_index_tasks.document_version AND active.task_type = 'semantic' AND active.status IN ('pending','running','waiting_model'))",
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
    await refreshRAGService();
    const db = DatabaseService.getInstance().getDbManager();
    const result = await db.execute(
      "UPDATE document_index_tasks SET status = 'pending', error = NULL, updated_at = ? WHERE id = (SELECT t.id FROM document_index_tasks t JOIN documents d ON d.id = t.document_id AND d.index_version = t.document_version WHERE t.document_id = ? AND t.task_type = 'semantic' AND t.status IN ('failed','cancelled','waiting_model') ORDER BY t.created_at DESC, t.rowid DESC LIMIT 1) AND NOT EXISTS (SELECT 1 FROM document_index_tasks active WHERE active.document_id = document_index_tasks.document_id AND active.document_version = document_index_tasks.document_version AND active.task_type = 'semantic' AND active.id != document_index_tasks.id AND active.status IN ('pending','running','waiting_model'))",
      [Date.now(), documentId],
    );
    const active = await db.select("SELECT 1 FROM document_index_tasks t JOIN documents d ON d.id = t.document_id AND d.index_version = t.document_version WHERE t.document_id = ? AND t.task_type = 'semantic' AND t.status IN ('pending','running','waiting_model') LIMIT 1", [documentId]);
    if (result.rowsAffected || active.length) void this.drain();
    return Boolean(result.rowsAffected || active.length);
  }

  private async drain(): Promise<void> {
    if (this.running || typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    this.running = true;
    try {
      const db = DatabaseService.getInstance().getDbManager();
      while (true) {
        const tasks = await db.select<PendingTask>(`SELECT id, document_id, document_version, task_type FROM document_index_tasks
          WHERE status = 'pending' ORDER BY CASE task_type WHEN 'lexical' THEN 0 ELSE 1 END, created_at LIMIT 1`);
        if (!tasks.length) break;
        await this.process(tasks[0]).catch(async (error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (error instanceof EmbeddingModelChangedError) {
            await db.execute("UPDATE document_index_tasks SET status = 'pending', updated_at = ? WHERE id = ? AND status = 'running'", [Date.now(), tasks[0].id]);
            return;
          }
          if (error instanceof EmbeddingModelUnavailableError) {
            // Waiting for a model is not a failure: keep the lexical index
            // usable and leave the task discoverable.
            await db.execute(
              "UPDATE document_index_tasks SET status = 'waiting_model', error = ?, updated_at = ? WHERE id = ? AND status = 'running'",
              [message, Date.now(), tasks[0].id],
            );
            await db.execute("UPDATE documents SET semantic_status = 'waiting_model' WHERE id = ? AND index_version = ?", [tasks[0].document_id, tasks[0].document_version]);
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
        this.changed(tasks[0].document_id);
      }
    } finally { this.running = false; }
  }

  private async process(task: PendingTask): Promise<void> {
    const db = DatabaseService.getInstance().getDbManager();
    if (task.task_type === 'lexical') {
      const claimed = await db.execute("UPDATE document_index_tasks SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'pending'", [Date.now(), task.id]);
      if (!claimed.rowsAffected) return;
      const docs = await db.select<{ file_path: string; index_version: number; active_index_batch_id: string | null }>('SELECT file_path, index_version, active_index_batch_id FROM documents WHERE id = ?', [task.document_id]);
      if (!docs.length || docs[0].index_version !== task.document_version) return;
      const { DocumentIndexer } = await import('./DocumentIndexer');
      const result = await new DocumentIndexer().reindexDocument(task.document_id, docs[0].file_path);
      if (!result.success) {
        const status = docs[0].active_index_batch_id ? 'indexed' : 'failed';
        await db.execute('UPDATE doc_knowledge_mappings SET status = ? WHERE document_id = ?', [status, task.document_id]);
      }
      return;
    }
    const claimed = await db.execute("UPDATE document_index_tasks SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'", [Date.now(), task.id]);
    if (!claimed.rowsAffected) return;
    await db.execute("UPDATE documents SET semantic_status = 'processing' WHERE id = ? AND index_version = ?", [task.document_id, task.document_version]);
    this.changed(task.document_id);
    const docs = await db.select<{ active_index_batch_id: string; index_version: number; file_path: string }>(
      'SELECT active_index_batch_id, index_version, file_path FROM documents WHERE id = ?', [task.document_id]);
    if (!docs.length || docs[0].index_version !== task.document_version || !docs[0].active_index_batch_id) {
      throw new Error('文档版本已变化');
    }
    const batchId = docs[0].active_index_batch_id;
    const chunks = await db.select<{ id: string; search_text: string }>(
      'SELECT id, search_text FROM document_chunks WHERE document_id = ? AND batch_id = ? ORDER BY chunk_index',
      [task.document_id, batchId]);
    await withRAGService(async (rag, isCurrent) => {
    const embedding = rag.getEmbeddingService();
    if (!embedding.isUsableForRag()) throw new EmbeddingModelUnavailableError('未配置可用的 embedding 模型');
    const fingerprint = embedding.getEmbeddingFingerprint();
    if (!fingerprint) throw new Error('embedding 模型指纹不可用');
    const { invoke } = await import('@tauri-apps/api/core');
    const pinned = await invoke<boolean>('claim_semantic_model', { db: db.getConnectionUrl(), taskId: task.id, fingerprint });
    if (!pinned) return;
    const counter = embedding.getTokenCounter();
    const budget: EmbeddingTextBudget = {
      fingerprint,
      accepts: async (texts) => {
        if (counter) return (await counter(texts)).map((count) => count <= embedding.getMaxInputTokens());
        const result: boolean[] = [];
        for (const text of texts) {
          try { await embedding.generateEmbeddings([text]); result.push(true); }
          catch (error) { if (error instanceof EmbeddingInputError) result.push(false); else throw error; }
        }
        return result;
      },
    };
    const reindex = async () => {
      if (!isCurrent()) throw new EmbeddingModelChangedError('Embedding model changed');
      // Publication validates this live parent and supersedes it atomically.
      // Cancelling it here would make every legitimate adaptation fail that guard.
      const { DocumentIndexer } = await import('./DocumentIndexer');
      const result = await new DocumentIndexer().reindexDocument(task.document_id, docs[0].file_path, { embeddingBudget: budget, semanticParentTaskId: task.id });
      if (!result.success) {
        const failed = await db.execute("UPDATE document_index_tasks SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status = 'running'", [result.error || 'Model-aware reindex failed', Date.now(), task.id]);
        if (failed.rowsAffected) await db.execute("UPDATE documents SET semantic_status = 'failed' WHERE id = ? AND index_version = ?", [task.document_id, task.document_version]);
        throw new EmbeddingInputError(result.error || 'Model-aware reindex failed');
      }
    };
    if (counter && !(await budget.accepts(chunks.map((chunk) => chunk.search_text))).every(Boolean)) {
      await reindex(); return;
    }
    const batchSize = 16;
    for (let index = 0; index < chunks.length; index += batchSize) {
      const status = await db.select<{ status: string }>('SELECT status FROM document_index_tasks WHERE id = ?', [task.id]);
      if (status[0]?.status === 'cancelled') throw new Error('语义索引任务已取消');
      const batch = chunks.slice(index, index + batchSize);
      if (!isCurrent()) throw new EmbeddingModelChangedError('Embedding model changed');
      let generated: number[][];
      try { generated = await embedding.generateEmbeddings(batch.map((chunk) => chunk.search_text)); }
      catch (error) {
        if (error instanceof EmbeddingInputError) { await reindex(); return; }
        throw error;
      }
      if (!isCurrent()) throw new EmbeddingModelChangedError('Embedding model changed');
      const vectors = batch.map((chunk, offset) => ({ chunkId: chunk.id, embedding: generated[offset] }));
      await invoke('store_document_embeddings', { db: db.getConnectionUrl(), taskId: task.id,
        documentId: task.document_id, batchId, documentVersion: task.document_version,
        fingerprint, embeddings: vectors, replaceExisting: index === 0,
        complete: index + batch.length >= chunks.length, createdAt: Date.now() });
    }
    });
  }
}

export const semanticIndexQueue = new SemanticIndexQueue();
