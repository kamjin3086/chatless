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
import { EmbeddingService } from '../embedding/EmbeddingService';
import type { EmbeddingServiceOptions } from '../embedding/types';
import { RetrievalService } from '../retrieval/RetrievalService';
import { generateId } from '../utils/id';

/**
 * 文档索引器
 * 负责将文档转换为可搜索的向量索引
 */
export class DocumentIndexer {
  private documentExtractor: DocumentExtractionService;
  private chunkingService: ChunkingService;
  private embeddingService: EmbeddingService | null = null;
  private retrievalService: RetrievalService;
  private isInitialized = false;

  constructor() {
    this.documentExtractor = new DocumentExtractionService();
    this.chunkingService = new ChunkingService();
    this.retrievalService = new RetrievalService();
  }

  /**
   * 初始化嵌入服务
   * 使用用户配置的嵌入策略和设置
   */
  private async initializeEmbeddingService(): Promise<void> {
    if (this.embeddingService && this.isInitialized) {
      return;
    }

    try {
      // 加载用户配置的知识库设置
      const { loadKnowledgeBaseConfig } = await import('../knowledgeBaseConfig');
      const knowledgeBaseConfig = await loadKnowledgeBaseConfig();
      const embeddingConfig = knowledgeBaseConfig.embedding;

      console.log(`[DocumentIndexer] 使用配置的嵌入策略: ${embeddingConfig.strategy}`);

      let serviceConfig: EmbeddingServiceOptions;

      if (embeddingConfig.strategy === 'ollama') {
        // 获取 Ollama URL
        const { OllamaConfigService } = await import('../config/OllamaConfigService');
        const apiUrl = embeddingConfig.apiUrl || await OllamaConfigService.getOllamaUrl();

        serviceConfig = {
          config: {
            strategy: 'ollama',
            apiUrl,
            modelName: embeddingConfig.modelName || 'nomic-embed-text',
            timeout: embeddingConfig.timeout || 30000,
            maxBatchSize: embeddingConfig.maxBatchSize || 10
          },
          enableCache: true,
          cacheSize: 1000
        };

        console.log(`[DocumentIndexer] 使用 Ollama URL: ${apiUrl}, 模型: ${embeddingConfig.modelName || 'nomic-embed-text'}`);
      } else {
        // local-onnx 策略
        serviceConfig = {
          config: {
            strategy: 'local-onnx',
            modelPath: embeddingConfig.modelPath,
            modelName: embeddingConfig.modelName,
            tokenizerPath: embeddingConfig.tokenizerPath,
            timeout: embeddingConfig.timeout || 30000,
            maxBatchSize: embeddingConfig.maxBatchSize || 32
          },
          enableCache: true,
          cacheSize: 1000
        };

        console.log(`[DocumentIndexer] 使用本地 ONNX 模型: ${embeddingConfig.modelPath}`);
      }

      this.embeddingService = new EmbeddingService(serviceConfig);
      await this.embeddingService.initialize();
      this.isInitialized = true;

      console.log(`[DocumentIndexer] 嵌入服务初始化完成 (策略: ${embeddingConfig.strategy})`);
    } catch (error) {
      console.error('[DocumentIndexer] 嵌入服务初始化失败:', error);
      throw error;
    }
  }

  /**
   * 重新初始化嵌入服务
   * 当用户更改嵌入配置时调用
   */
  async reinitializeEmbeddingService(): Promise<void> {
    // 清理现有服务
    if (this.embeddingService) {
      try {
        await this.embeddingService.cleanup();
      } catch (error) {
        console.warn('[DocumentIndexer] 清理嵌入服务时出错:', error);
      }
    }

    this.embeddingService = null;
    this.isInitialized = false;

    // 重新初始化
    await this.initializeEmbeddingService();
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

    try {
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
      const scope = options.knowledgeBaseId ? `${documentId}_${options.knowledgeBaseId}` : documentId;
      parsed.blocks = parsed.blocks.map((b, i) => ({
        ...b,
        documentId,
        id: `blk_${scope}_${i}`,
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

      // 给同一文档在不同知识库中的索引使用稳定且不冲突的 ID。
      retrievalChunks.forEach((chunk, i) => {
        chunk.id = `chk_${scope}_${i}`;
        chunk.knowledgeBaseId = options.knowledgeBaseId;
        chunk.metadata = {
          ...chunk.metadata,
          documentHash: parsed!.metadata.fileHash,
          parserVersion: PARSER_VERSION,
          chunkSchemaVersion: CHUNK_SCHEMA_VERSION,
        };
      });
      let embeddingFingerprint: string | null = null;

      // 3. 先发布原文和 FTS。embedding 是增强能力，失败不能让文档消失。
      task.status = IndexingStatus.STORING;
      task.progress = 50;
      options.progressCallback?.(task);

      if (options.knowledgeBaseId) {
        const { EvidenceStore } = await import('../rag/evidenceStore');
        // Keep the currently published lexical index until the replacement
        // transaction succeeds. Vector cleanup happens only after publish.
        const oldIds = await EvidenceStore.getDocumentIndexIds(documentId, options.knowledgeBaseId);
        await EvidenceStore.replaceDocumentIndex({
          documentId,
          knowledgeBaseId: options.knowledgeBaseId,
          blocks: parsed.blocks,
          chunks: retrievalChunks,
        });
        if (oldIds.length) {
          await this.retrievalService.removeVectors(oldIds).catch(() => {});
        }
      }

      // 4. Publish first, then initialize and generate optional embeddings.
      // A failure here is a semantic-index failure only; the searchable
      // lexical batch published above remains active.
      task.status = IndexingStatus.EMBEDDING;
      task.progress = 70;
      options.progressCallback?.(task);
      let validChunks: typeof retrievalChunks = [];
      if (!this.embeddingService || !this.isInitialized) {
        try {
          await this.initializeEmbeddingService();
        } catch (error) {
          console.warn('[DocumentIndexer] embedding unavailable; keeping lexical index:', error);
          this.embeddingService = null;
          this.isInitialized = false;
        }
      }
      embeddingFingerprint = this.embeddingService?.getEmbeddingFingerprint() || null;
      if (this.embeddingService?.isUsableForRag()) {
        try {
          const embeddings = await this.embeddingService.generateEmbeddings(
            retrievalChunks.map((c) => c.searchText)
          );
          retrievalChunks.forEach((chunk, i) => { chunk.embedding = embeddings[i]; });
          validChunks = retrievalChunks.filter((c) => Array.isArray(c.embedding) && c.embedding.length > 0);
        } catch (error) {
          console.warn('[DocumentIndexer] embedding failed; keeping lexical index:', error);
        }
      }

      if (validChunks.length > 0) {
        try {
          await this.retrievalService.addVectors(
            validChunks.map((chunk) => ({
            id: chunk.id,
            embedding: chunk.embedding!,
            content: chunk.sourceText,
            metadata: {
              ...chunk.metadata,
              documentId,
              knowledgeBaseId: options.knowledgeBaseId,
              embeddingFingerprint,
              sourceStartBlock: chunk.sourceStartBlock,
              sourceEndBlock: chunk.sourceEndBlock,
              searchText: chunk.searchText,
            },
            }))
          );
        } catch (error) {
          // The lexical batch is already published and is the required
          // baseline. A vector write failure must downgrade semantic search,
          // rather than turn an otherwise readable document into a failed
          // import or leave the mapping stuck in `failed`.
          console.warn('[DocumentIndexer] vector persistence failed; keeping lexical index:', error);
          validChunks = [];
        }
      }

      const semanticIndexed = validChunks.length > 0;
      try {
        const dbService = (await import('../database/services/DatabaseService')).DatabaseService.getInstance();
        await dbService.getDbManager().execute(
          `UPDATE documents SET is_indexed = 1, file_hash = ?, parser_version = ?, chunk_schema_version = ?, embedding_model = ?, embedding_dimension = ?, embedding_fingerprint = ?, updated_at = ? WHERE id = ?`,
          [
            parsed.metadata.fileHash,
            PARSER_VERSION,
            CHUNK_SCHEMA_VERSION,
            semanticIndexed ? this.embeddingService?.getStrategyName() : null,
            semanticIndexed ? this.embeddingService?.getDimension() : null,
            semanticIndexed ? embeddingFingerprint : null,
            Date.now(),
            documentId,
          ]
        );
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
    const ids = await EvidenceStore.deleteDocumentIndex(documentId, knowledgeBaseId);
    if (ids.length) {
      await this.retrievalService.removeVectors(ids).catch(() => {});
    }
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

    // 监听知识库配置变更
    const setupConfigListener = async () => {
      try {
        const { getKnowledgeBaseConfigManager } = await import('../knowledgeBaseConfig');
        const configManager = getKnowledgeBaseConfigManager();

        configManager.addListener(async (config) => {
          console.log('[DocumentIndexer] 检测到知识库配置变更，重新初始化嵌入服务...');
          try {
            await globalDocumentIndexer?.reinitializeEmbeddingService();
            console.log('[DocumentIndexer] 嵌入服务重新初始化完成');
          } catch (error) {
            console.error('[DocumentIndexer] 重新初始化嵌入服务失败:', error);
          }
        });
      } catch (error) {
        console.warn('[DocumentIndexer] 设置配置监听器失败:', error);
      }
    };

    setupConfigListener();
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
