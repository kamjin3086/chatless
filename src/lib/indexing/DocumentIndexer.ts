import {
  IndexingTask,
  IndexingStatus,
  IndexingOptions,
  IndexingResult,
  ChunkData,
  IndexingError
} from './types';
import { DocumentExtractionService } from '../document/DocumentExtractor';
import { ChunkingService } from '../chunking/ChunkingService';
import { generateId } from '../utils/id';

/**
 * 文档索引器
 * 负责将文档转换为可搜索的向量索引
 */
export class DocumentIndexer {
  private documentExtractor: DocumentExtractionService;
  private chunkingService: ChunkingService;

  constructor() {
    this.documentExtractor = new DocumentExtractionService();
    this.chunkingService = new ChunkingService();
  }

  /**
   * 索引单个文档
   */
  async indexDocument(
    documentId: string,
    filePath: string,
    options: IndexingOptions = {}
  ): Promise<IndexingResult> {
    const startTime = Date.now();
    const task: IndexingTask = {
      id: generateId(),
      documentId,
      filePath,
      status: IndexingStatus.PENDING,
      progress: 0,
      startTime: new Date()
    };
    let expectedDocumentVersion: number | undefined;

    try {
      const dbService = (await import('../database/services/DatabaseService')).DatabaseService.getInstance();
      const db = dbService.getDbManager();
      const docs = await db.select<{ index_version: number }>('SELECT index_version FROM documents WHERE id = ?', [documentId]);
      if (!docs.length) throw new IndexingError('文档记录不存在', task.id, documentId);
      expectedDocumentVersion = Number(docs[0].index_version || 0);
      const now = Date.now();
      await db.execute(`INSERT INTO document_index_tasks
        (id, document_id, document_version, task_type, status, created_at, updated_at)
        VALUES (?, ?, ?, 'lexical', 'running', ?, ?)`, [task.id, documentId, expectedDocumentVersion, now, now]);
      // 1. 文档内容提取。Embedding is deliberately not initialized here:
      // lexical search is the durable baseline and must become available even
      // when a local model is unavailable or slow to load.
      task.status = IndexingStatus.EXTRACTING;
      task.progress = 10;
      options.progressCallback?.(task);

      console.log(`开始提取文档: ${filePath}`);
      const extractionResult = await this.documentExtractor.extractDocument(filePath);

      if (!extractionResult.success) {
        throw new IndexingError(
          `文档提取失败: ${extractionResult.error}`,
          task.id,
          documentId
        );
      }

      let parsed = extractionResult.parsed;
      if (!parsed) {
        parsed = {
          title: extractionResult.metadata.title || documentId,
          fileType: extractionResult.metadata.fileType,
          blocks: [{
            id: 'blk_0',
            documentId,
            blockIndex: 0,
            type: 'paragraph',
            text: extractionResult.text,
          }],
          plainText: extractionResult.text,
          metadata: {
            filePath,
            fileHash: await (await import('../utils/sha256')).sha256Hex(extractionResult.text),
            parserVersion: (await import('../rag/constants')).PARSER_VERSION,
          },
        };
      }
      parsed.blocks = parsed.blocks.map((b, i) => ({
        ...b,
        documentId,
        id: `blk_${documentId}_${i}`,
        blockIndex: i,
      }));

      const documentContent = parsed.plainText || extractionResult.text;
      if (!documentContent.trim()) {
        throw new IndexingError(
          '文档未提取到可检索文本，可能是扫描件、加密文件或仅包含图片',
          task.id,
          documentId,
        );
      }
      console.log(`文档提取完成，内容长度: ${documentContent.length} 字符, blocks=${parsed.blocks.length}`);

      // 2. 结构优先分块
      task.status = IndexingStatus.CHUNKING;
      task.progress = 30;
      options.progressCallback?.(task);

      const { mergeSourceBlocksToChunks } = await import('../chunking/strategies/StructuredBlockMerger');
      const { PARSER_VERSION, CHUNK_SCHEMA_VERSION } = await import('../rag/constants');
      const chunkMaxTokens = 800;
      const retrievalChunks = mergeSourceBlocksToChunks(
        parsed,
        documentId,
        chunkMaxTokens
          ? {
              maxTokens: chunkMaxTokens,
              targetTokens: Math.min(500, Math.max(32, chunkMaxTokens - 64)),
            }
          : undefined,
      );
      if (retrievalChunks.length === 0) {
        throw new IndexingError('结构化分块结果为空', task.id, documentId);
      }

      // Chunks belong to the document. Knowledge bases only grant access.
      retrievalChunks.forEach((chunk, i) => {
        chunk.id = `pending_${documentId}_${i}`;
        chunk.metadata = {
          ...chunk.metadata,
          documentHash: parsed!.metadata.fileHash,
          parserVersion: PARSER_VERSION,
          chunkSchemaVersion: CHUNK_SCHEMA_VERSION,
        };
      });
      // 3. 先发布原文和 FTS。embedding 是增强能力，失败不能让文档消失。
      task.status = IndexingStatus.STORING;
      task.progress = 50;
      options.progressCallback?.(task);

      {
        const { EvidenceStore } = await import('../rag/evidenceStore');
        await EvidenceStore.replaceDocumentIndex({
          documentId,
          knowledgeBaseId: options.knowledgeBaseId,
          chunks: retrievalChunks,
          taskId: task.id,
          expectedDocumentVersion,
        });
      }

      try {
        const dbService = (await import('../database/services/DatabaseService')).DatabaseService.getInstance();
        await dbService.getDbManager().execute(
          `UPDATE documents SET is_indexed = 1, file_hash = ?, parser_version = ?, chunk_schema_version = ?, updated_at = ? WHERE id = ?`,
          [
            parsed.metadata.fileHash,
            PARSER_VERSION,
            CHUNK_SCHEMA_VERSION,
            Date.now(),
            documentId,
          ]
        );
        const { semanticIndexQueue } = await import('./SemanticIndexQueue');
        await semanticIndexQueue.enqueue(documentId);
      } catch (e) {
        console.warn('[DocumentIndexer] 更新 documents 版本字段失败:', e);
      }

      const chunkData: ChunkData[] = retrievalChunks.map((chunk, index) => ({
        id: chunk.id,
        content: chunk.sourceText,
        embedding: chunk.embedding,
        metadata: {
          documentId,
          chunkIndex: index,
          startPosition: chunk.sourceStartBlock,
          endPosition: chunk.sourceEndBlock,
          chunkType: 'structured',
          parentDocument: filePath,
        },
      }));

      // 7. 完成
      task.status = IndexingStatus.COMPLETED;
      task.progress = 100;
      task.endTime = new Date();
      task.chunks = chunkData;
      options.progressCallback?.(task);

      const processingTime = Date.now() - startTime;
      console.log(`文档索引完成，耗时: ${processingTime}ms`);

      return {
        taskId: task.id,
        success: true,
        documentId,
        chunksProcessed: chunkData.length,
        totalChunks: chunkData.length,
        processingTime
      };

    } catch (error) {
      task.status = IndexingStatus.FAILED;
      task.error = error instanceof Error ? error.message : String(error);
      task.endTime = new Date();
      options.progressCallback?.(task);

      console.error(`文档索引失败: ${filePath}`, error);
      try {
        const dbService = (await import('../database/services/DatabaseService')).DatabaseService.getInstance();
        await dbService.getDbManager().execute(
          "UPDATE document_index_tasks SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status = 'running'",
          [task.error, Date.now(), task.id],
        );
      } catch { /* the task may not have been created */ }

      return {
        taskId: task.id,
        success: false,
        documentId,
        chunksProcessed: 0,
        totalChunks: 0,
        processingTime: Date.now() - startTime,
        error: task.error
      };
    }
  }

  /**
   * 批量索引文档
   */
  async indexDocuments(
    documents: Array<{ documentId: string; filePath: string }>,
    options: IndexingOptions = {}
  ): Promise<IndexingResult[]> {
    console.log(`开始批量索引 ${documents.length} 个文档`);

    const results: IndexingResult[] = [];
    // Keep the default queue single-document to bound SQLite/WebView memory;
    // callers can opt into parallelism explicitly for controlled imports.
    const maxConcurrency = options.maxConcurrency || 1;

    // 分批处理以控制并发数
    for (let i = 0; i < documents.length; i += maxConcurrency) {
      const batch = documents.slice(i, i + maxConcurrency);

      console.log(`处理批次 ${Math.floor(i / maxConcurrency) + 1}, 文档数: ${batch.length}`);

      const batchPromises = batch.map(doc =>
        this.indexDocument(doc.documentId, doc.filePath, {
          ...options,
          progressCallback: (task) => {
            console.log(`文档 ${doc.documentId} 进度: ${task.progress}% (${task.status})`);
            options.progressCallback?.(task);
          }
        })
      );

      const batchResults = await Promise.allSettled(batchPromises);

      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          console.error(`批量索引失败: ${batch[index].filePath}`, result.reason);
          results.push({
            taskId: generateId(),
            success: false,
            documentId: batch[index].documentId,
            chunksProcessed: 0,
            totalChunks: 0,
            processingTime: 0,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason)
          });
        }
      });
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`批量索引完成: ${successCount}/${documents.length} 成功`);

    return results;
  }

  /**
   * 重新索引文档（更新已存在的文档）
   */
  async reindexDocument(
    documentId: string,
    filePath: string,
    options: IndexingOptions = {}
  ): Promise<IndexingResult> {
    // indexDocument replaces the active batch transactionally and keeps the
    // old batch available if parsing or storage fails.
    return this.indexDocument(documentId, filePath, options);
  }

  async removeDocumentIndex(documentId: string, knowledgeBaseId?: string): Promise<void> {
    const { EvidenceStore } = await import('../rag/evidenceStore');
    await EvidenceStore.deleteDocumentIndex(documentId);
  }

  /**
   * 验证文档是否可以被索引
   */
  async validateDocument(filePath: string): Promise<{
    isValid: boolean;
    reason?: string;
    fileType?: string;
  }> {
    try {
      const validation = await this.documentExtractor.validateFile(filePath);

      if (!validation.isSupported) {
        return {
          isValid: false,
          reason: validation.reason,
          fileType: validation.fileType
        };
      }

      return {
        isValid: true,
        fileType: validation.fileType
      };

    } catch (error) {
      return {
        isValid: false,
        reason: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 获取支持的文件类型
   */
  async getSupportedFileTypes(): Promise<string[]> {
    return await this.documentExtractor.getSupportedTypes();
  }

  /**
   * 获取索引器统计信息
   */
  async getIndexerStats(): Promise<{
    supportedFileTypes: string[];
    embeddingModel: string;
    chunkingStrategies: string[];
    vectorStoreStats: any;
  }> {
    const supportedFileTypes = await this.documentExtractor.getSupportedTypes();
    const chunkingStrategies = this.chunkingService.getAvailableStrategies();

    return {
      supportedFileTypes,
      embeddingModel: 'default',
      chunkingStrategies,
      vectorStoreStats: {}
    };
  }
}

// 全局 DocumentIndexer 实例管理
let globalDocumentIndexer: DocumentIndexer | null = null;

/**
 * 获取全局 DocumentIndexer 实例
 */
export function getDocumentIndexer(): DocumentIndexer {
  if (!globalDocumentIndexer) {
    globalDocumentIndexer = new DocumentIndexer();
  }

  return globalDocumentIndexer;
}

 /**
  * 重置全局 DocumentIndexer 实例
  * 用于测试或强制重新创建实例
  */
 export function resetDocumentIndexer(): void {
   globalDocumentIndexer = null;
 }
