import { DatabaseService } from '@/lib/database/services/DatabaseService';

// 重新导出Repository中的类型定义，保持API兼容性
export type { KnowledgeBase, DocKnowledgeMapping } from '@/lib/database/repositories/KnowledgeBaseRepository';

// 知识片段定义（保持兼容性）
export interface KnowledgeChunk {
  id: string;
  knowledgeBaseId: string;
  documentId: string;
  content: string;
  embedding?: Uint8Array;
  metadata?: string;
  createdAt: number;
}

// 获取数据库服务实例
const getDatabaseService = () => DatabaseService.getInstance();
let interruptedIndexingRecovered = false;

/**
 * 知识库服务 - 重构版本
 * 使用新的Repository模式替代旧的队列系统
 */
export const KnowledgeService = {
  /**
   * 初始化数据库（确保DatabaseService已正确初始化）
   */
  async initDb(): Promise<void> {
    try {
      const dbService = getDatabaseService();
      
      // 检查数据库服务是否已初始化
      try {
        const dbManager = dbService.getDbManager();
        // 测试数据库连接
        await dbManager.select('SELECT 1 as test');
        console.log('[KnowledgeService] 数据库连接验证成功');
      } catch (error) {
        console.log('[KnowledgeService] 数据库服务未初始化，正在初始化...');
        
        // 如果数据库服务未初始化，则初始化它
        const { DATABASE_CONFIG } = await import('./config/database');
        await dbService.initialize(DATABASE_CONFIG.MAIN_DATABASE);
        
        console.log('[KnowledgeService] 数据库服务初始化完成');
      }

      // A process can exit while a mapping is in `indexing`. Convert that
      // transient state back to an actionable pending task exactly once per
      // process; the knowledge-base UI can then resume it through Rebuild.
      if (!interruptedIndexingRecovered) {
        await dbService.getDbManager().execute(
          `UPDATE doc_knowledge_mappings SET status = 'pending'
             WHERE status = 'indexing'`,
        );
        interruptedIndexingRecovered = true;
      }
    } catch (error) {
      console.error('[KnowledgeService] 数据库初始化失败:', error);
      throw error;
    }
  },

  /**
   * 测试数据库连接和基本功能
   */
  async testDatabase(): Promise<{ success: boolean; message: string }> {
    try {
      console.log('[Test] 开始测试知识库数据库...');

      const dbService = getDatabaseService();
      const knowledgeBaseRepo = dbService.getKnowledgeBaseRepository();

      // 测试基本查询
      const knowledgeBases = await knowledgeBaseRepo.getAllKnowledgeBases();
      console.log('[Test] 基本查询测试成功，知识库数量:', knowledgeBases.length);

      // 测试统计功能
      if (knowledgeBases.length > 0) {
        const stats = await knowledgeBaseRepo.getKnowledgeBaseStats(knowledgeBases[0].id);
        console.log('[Test] 统计查询测试成功:', stats);
      }

      console.log('[Test] 知识库数据库测试全部通过');
      return { success: true, message: '知识库数据库连接和功能测试通过' };
    } catch (error) {
      console.error('[Test] 知识库数据库测试失败:', error);
      return { 
        success: false, 
        message: `知识库数据库测试失败: ${error instanceof Error ? error.message : '未知错误'}` 
      };
    }
  },

  /**
   * 测试数据库连接和事务处理
   */
  async testDatabaseTransactions(): Promise<{ success: boolean; message: string }> {
    try {
      const dbService = getDatabaseService();
      const knowledgeBaseRepo = dbService.getKnowledgeBaseRepository();
      
      const knowledgeBases = await knowledgeBaseRepo.getAllKnowledgeBases();
      
      return {
        success: true,
        message: `知识库数据库连接测试成功，知识库数量: ${knowledgeBases.length}`
      };
    } catch (error) {
      return {
        success: false,
        message: `知识库数据库连接测试失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  },

  /**
   * 创建知识库
   */
  async createKnowledgeBase(
    name: string, 
    description: string, 
    icon: string = 'database',
    isEncrypted: boolean = false
  ) {
    try {
      const dbService = getDatabaseService();
      const knowledgeBaseRepo = dbService.getKnowledgeBaseRepository();
      
      return await knowledgeBaseRepo.createKnowledgeBase(name, description, icon, isEncrypted);
    } catch (error) {
      console.error(`创建知识库失败: ${name}`, error);
      throw error;
    }
  },

  /**
   * 获取所有知识库
   */
  async getAllKnowledgeBases() {
    try {
      const dbService = getDatabaseService();
      const knowledgeBaseRepo = dbService.getKnowledgeBaseRepository();
      
      return await knowledgeBaseRepo.getAllKnowledgeBases();
    } catch (error) {
      console.error('获取所有知识库失败:', error);
      throw error;
    }
  },

  /**
   * 根据ID获取知识库
   */
  async getKnowledgeBase(id: string) {
    try {
      const dbService = getDatabaseService();
      const knowledgeBaseRepo = dbService.getKnowledgeBaseRepository();
      
      return await knowledgeBaseRepo.getKnowledgeBaseById(id);
    } catch (error) {
      console.error(`获取知识库失败 (ID: ${id}):`, error);
      throw error;
    }
  },

  /**
   * 更新知识库
   */
  async updateKnowledgeBase(id: string, updates: {
    name?: string;
    description?: string;
    icon?: string;
    isEncrypted?: boolean;
  }) {
    try {
      const dbService = getDatabaseService();
      const knowledgeBaseRepo = dbService.getKnowledgeBaseRepository();
      
      return await knowledgeBaseRepo.updateKnowledgeBase(id, updates);
    } catch (error) {
      console.error(`更新知识库失败 (ID: ${id}):`, error);
      throw error;
    }
  },

  /**
   * 删除知识库
   */
  async deleteKnowledgeBase(id: string): Promise<boolean> {
    try {
      const dbService = getDatabaseService();
      const knowledgeBaseRepo = dbService.getKnowledgeBaseRepository();
      
      console.log(`开始删除知识库: ${id}`);
      const affectedMappings = await knowledgeBaseRepo.getKnowledgeBaseDocuments(id);
      const result = await knowledgeBaseRepo.deleteKnowledgeBase(id);
      
      if (result) {
        try {
          const { UnifiedFileService } = await import('./unifiedFileService');
          const affectedDocumentIds = [...new Set(affectedMappings.map((mapping) => mapping.documentId))];
          await Promise.all(affectedDocumentIds.map(async (documentId) => {
            const remainingMappings = await knowledgeBaseRepo.getDocumentKnowledgeBases(documentId);
            const remainingIndexed = remainingMappings.find((item) => item.status === 'indexed');
            const remaining = remainingIndexed || remainingMappings[0];
            await UnifiedFileService.updateFile(documentId, {
              knowledgeBaseId: remaining?.knowledgeBaseId,
              isIndexed: remaining?.status === 'indexed',
            });
          }));
        } catch (syncError) {
          console.warn('[KnowledgeService] 删除知识库后同步文件关联失败:', syncError);
        }
        console.log(`知识库删除成功: ${id}`);
      } else {
        console.warn(`知识库删除失败（未找到）: ${id}`);
      }
      
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // 检查是否是数据库锁定错误
      if (errorMessage.includes('database is locked') || 
          errorMessage.includes('database is busy') ||
          errorMessage.includes('code: 5')) {
        console.error(`删除知识库失败 (ID: ${id}): 数据库被锁定，请稍后重试`, error);
        throw new Error(`数据库被锁定，请稍后重试。如果问题持续存在，请重启应用。`);
      }
      
      console.error(`删除知识库失败 (ID: ${id}):`, error);
      throw error;
    }
  },

  /**
   * 获取知识库的文档映射
   */
  async getKnowledgeBaseDocuments(knowledgeBaseId: string) {
    try {
      const dbService = getDatabaseService();
      const knowledgeBaseRepo = dbService.getKnowledgeBaseRepository();
      
      return await knowledgeBaseRepo.getKnowledgeBaseDocuments(knowledgeBaseId);
    } catch (error) {
      console.error(`获取知识库文档失败 (ID: ${knowledgeBaseId}):`, error);
      throw error;
    }
  },

  /**
   * 添加文档到知识库
   */
  async addDocumentToKnowledgeBase(
    documentId: string, 
    knowledgeBaseId: string,
    options: {
      onProgress?: (progress: number, message: string) => void;
      skipIfExists?: boolean;
    } = {}
  ) {
    try {
      const dbService = getDatabaseService();
      const knowledgeBaseRepo = dbService.getKnowledgeBaseRepository();
      
      // 检查是否已存在
      if (options.skipIfExists) {
        const exists = await knowledgeBaseRepo.isDocumentInKnowledgeBase(documentId, knowledgeBaseId);
        if (exists) {
          options.onProgress?.(100, '文档已存在于知识库中');
          return null;
        }
      }

      options.onProgress?.(10, '准备文档索引...');
      
      // 1. 创建文档映射关系，状态为indexing
      const mapping = await knowledgeBaseRepo.addDocumentToKnowledgeBase(
        documentId, 
        knowledgeBaseId, 
        'indexing'
      );

      try {
        // 2. 获取文档信息
        options.onProgress?.(20, '获取文档信息...');
        const { UnifiedFileService } = await import('./unifiedFileService');
        const document = await UnifiedFileService.getFile(documentId);
        
        if (!document) {
          throw new Error(`文档不存在: ${documentId}`);
        }

        // 3. 初始化文档索引器
        options.onProgress?.(30, '初始化索引服务...');
        const { DocumentIndexer } = await import('./indexing/DocumentIndexer');
        const indexer = new DocumentIndexer();

        // 4. 执行文档索引（包含提取、分块、嵌入生成、向量存储）
        options.onProgress?.(40, '开始文档索引...');
        
        const indexingResult = await indexer.indexDocument(
          documentId,
          document.filePath,
          {
            knowledgeBaseId, // 传递知识库ID以便存储时关联
            progressCallback: (task) => {
              // 将索引进度映射到总进度的40-90%区间
              const indexProgress = 40 + (task.progress * 0.5);
              let message = '';
              
              switch (task.status) {
                case 'extracting':
                  message = '提取文档内容...';
                  break;
                case 'chunking':
                  message = '文档分块处理...';
                  break;
                case 'embedding':
                  message = '生成嵌入向量...';
                  break;
                case 'storing':
                  message = '存储向量数据...';
                  break;
                default:
                  message = '处理中...';
              }
              
              options.onProgress?.(indexProgress, message);
            }
          }
        );

        if (!indexingResult.success) {
          throw new Error(`文档索引失败: ${indexingResult.error || '未知错误'}`);
        }

        // 删除/移除挂载关系可能与索引并发发生；不要把已撤销关系同步回文件记录。
        const stillMounted = await knowledgeBaseRepo.isDocumentInKnowledgeBase(documentId, knowledgeBaseId);
        if (!stillMounted) {
          throw new Error('文档已从知识库移除，放弃本次索引发布');
        }

        // 5. 更新映射状态为已索引
        options.onProgress?.(95, '更新索引状态...');
        await knowledgeBaseRepo.updateDocumentMappingStatus(
          documentId,
          knowledgeBaseId,
          'indexed'
        );

        // 6. 同步更新 UnifiedFileService 中的文件记录
        try {
          await UnifiedFileService.updateFile(documentId, {
            knowledgeBaseId: knowledgeBaseId,
            isIndexed: true
          });
          console.log(`[KnowledgeService] 已同步更新文件记录的知识库关联: ${documentId}`);
        } catch (syncError) {
          console.warn(`[KnowledgeService] ⚠️ 同步文件记录失败，但不影响索引结果:`, syncError);
        }

        options.onProgress?.(100, `文档索引完成 (${indexingResult.chunksProcessed} 个片段)`);
        
        return {
          ...mapping,
          indexingResult,
          chunksProcessed: indexingResult.chunksProcessed
        };

      } catch (indexError) {
        // 索引失败，更新状态为failed
        console.error('文档索引失败:', indexError);
        
        await knowledgeBaseRepo.updateDocumentMappingStatus(
          documentId,
          knowledgeBaseId,
          'failed'
        );
        
        // 可以选择删除映射关系，或保留以供重试
        // await knowledgeBaseRepo.removeDocumentFromKnowledgeBase(documentId, knowledgeBaseId);
        
        throw indexError;
      }

    } catch (error) {
      console.error(`添加文档到知识库失败: ${documentId} -> ${knowledgeBaseId}`, error);
      throw error;
    }
  },

  /**
   * 从知识库移除文档
   */
  async removeDocumentFromKnowledgeBase(documentId: string, knowledgeBaseId: string): Promise<boolean> {
    try {
      const dbService = getDatabaseService();
      const knowledgeBaseRepo = dbService.getKnowledgeBaseRepository();
      
      const success = await knowledgeBaseRepo.removeDocumentFromKnowledgeBase(documentId, knowledgeBaseId);
      
      if (success) {
        // 同步清除 UnifiedFileService 中的文件记录的知识库关联
        try {
          const { UnifiedFileService } = await import('./unifiedFileService');
          const remainingMappings = await knowledgeBaseRepo.getDocumentKnowledgeBases(documentId);
          const remainingIndexed = remainingMappings.find((item) => item.status === 'indexed');
          const remaining = remainingIndexed || remainingMappings[0];
          await UnifiedFileService.updateFile(documentId, {
            knowledgeBaseId: remaining?.knowledgeBaseId,
            isIndexed: remaining?.status === 'indexed',
          });
          console.log(`[KnowledgeService] 已同步文件剩余知识库关联: ${documentId}`);
        } catch (syncError) {
          console.warn(`[KnowledgeService] ⚠️ 清除文件记录关联失败，但不影响移除结果:`, syncError);
        }
      }
      
      return success;
    } catch (error) {
      console.error(`从知识库移除文档失败: ${documentId} from ${knowledgeBaseId}`, error);
      throw error;
    }
  },

  /**
   * 清理孤立的向量数据
   */
  async cleanupOrphanedVectors(): Promise<number> {
    try {
      const dbService = getDatabaseService();
      const knowledgeBaseRepo = dbService.getKnowledgeBaseRepository();
      
      return await knowledgeBaseRepo.cleanupOrphanedVectors();
    } catch (error) {
      console.error('清理孤立向量数据失败:', error);
      throw error;
    }
  },

  /**
   * 获取向量数据统计信息
   */
  async getVectorStats(): Promise<{
    totalVectors: number;
    activeVectors: number;
    deletedVectors: number;
    orphanedVectors: number;
  }> {
    try {
      const dbService = getDatabaseService();
      const knowledgeBaseRepo = dbService.getKnowledgeBaseRepository();
      
      return await knowledgeBaseRepo.getVectorStats();
    } catch (error) {
      console.error('获取向量统计信息失败:', error);
      return {
        totalVectors: 0,
        activeVectors: 0,
        deletedVectors: 0,
        orphanedVectors: 0
      };
    }
  },

  /**
   * 重新构建（重嵌入）指定知识库的全部文档。
   * 主要场景：用户切换嵌入模型 / 分词策略后需要刷新索引。
   */
  async rebuildKnowledgeBase(
    knowledgeBaseId: string,
    options: {
      onProgress?: (progress: number, message: string) => void;
    } = {}
  ) {
    try {
      const dbService = getDatabaseService();
      const knowledgeBaseRepo = dbService.getKnowledgeBaseRepository();

      // 1. 获取知识库中的所有文档映射
      const mappings = await this.getKnowledgeBaseDocuments(knowledgeBaseId);
      const totalDocs = mappings.length;
      const progressDenominator = Math.max(totalDocs, 1);
      let current = 0;

      for (const entry of mappings as any) {
        // getKnowledgeBaseDocuments returns mappings directly. Keep the
        // nested fallback for callers still passing the old
        // `{ mapping, document }` shape, but never silently skip a valid
        // mapping (the previous implementation rebuilt zero documents).
        const mapping = entry?.mapping || entry;
        if (!mapping?.documentId) continue;
        current += 1;
        const progBase = Math.floor((current - 1) / progressDenominator * 100);
        options.onProgress?.(progBase, `准备重建文档 ${current}/${totalDocs}`);

        const docId = mapping.documentId;
        await knowledgeBaseRepo.updateDocumentMappingStatus(docId, knowledgeBaseId, 'indexing');

        // 重新索引文档
        await this.addDocumentToKnowledgeBase(docId, knowledgeBaseId, {
          onProgress: (p, m) => {
            const overall = progBase + p / progressDenominator;
            options.onProgress?.(Math.min(99, Math.floor(overall)), m);
          },
          skipIfExists: false,
        });
      }

      options.onProgress?.(100, '知识库重建完成');
      return true;
    } catch (err) {
      console.error('[KnowledgeService] rebuildKnowledgeBase error', err);
      throw err;
    }
  },

  async getKnowledgeBaseIndexStatus(knowledgeBaseId: string): Promise<{
    total: number;
    indexed: number;
    pending: number;
    failed: number;
    needsRebuild: boolean;
  }> {
    try {
      const dbService = getDatabaseService();
      const db = dbService.getDbManager();
      const rows = await db.select<{ status: string; chunk_count: number }>(
        `SELECT m.status, COUNT(dc.id) AS chunk_count
           FROM doc_knowledge_mappings m
           JOIN documents d ON d.id = m.document_id
           LEFT JOIN document_chunks dc ON dc.document_id = m.document_id
             AND dc.batch_id = d.active_index_batch_id
          WHERE m.knowledge_base_id = ?
          GROUP BY m.document_id, m.status`,
        [knowledgeBaseId]
      );
      const counts = { total: 0, indexed: 0, pending: 0, failed: 0 };
      for (const row of rows || []) {
        const hasChunks = Number(row.chunk_count || 0) > 0;
        counts.total += 1;
        if (row.status === 'indexed' && hasChunks) counts.indexed += 1;
        else if (row.status === 'indexed' && !hasChunks) counts.pending += 1;
        else if (row.status === 'pending' || row.status === 'indexing') counts.pending += 1;
        else if (row.status === 'failed') counts.failed += 1;
      }
      const chunkRows = await db.select<{ n: number }>(
        `SELECT COUNT(*) as n FROM document_chunks dc JOIN documents d ON d.active_index_batch_id = dc.batch_id
          WHERE EXISTS (SELECT 1 FROM doc_knowledge_mappings m
            WHERE m.document_id = dc.document_id AND m.knowledge_base_id = ?)`,
        [knowledgeBaseId]
      );
      const retrievalChunks = Number(chunkRows?.[0]?.n || 0);
      return {
        ...counts,
        needsRebuild: counts.pending > 0 || counts.failed > 0 || (counts.total > 0 && retrievalChunks === 0),
      };
    } catch (error) {
      console.error('[KnowledgeService] getKnowledgeBaseIndexStatus error', error);
      return { total: 0, indexed: 0, pending: 0, failed: 0, needsRebuild: true };
    }
  },

  async getKnowledgeBaseStats(knowledgeBaseId: string): Promise<{documentCount: number, chunkCount: number}> {
    try {
      const dbService = getDatabaseService();
      const knowledgeBaseRepo = dbService.getKnowledgeBaseRepository();
      
      return await knowledgeBaseRepo.getKnowledgeBaseStats(knowledgeBaseId);
    } catch (error) {
      console.error(`获取知识库统计失败 (ID: ${knowledgeBaseId}):`, error);
      return { documentCount: 0, chunkCount: 0 };
    }
  },

  /**
   * 获取指定文档在知识库中的统计信息（目前仅包含分片数量）
   */
  async getDocumentStats(knowledgeBaseId: string, documentId: string): Promise<{
    chunkCount: number; lexicalStatus: string; semanticStatus: string;
  }> {
    try {
      const dbService = getDatabaseService();
      const dbManager = dbService.getDbManager();

      const result = await dbManager.select(
        `SELECT d.lexical_status as lexicalStatus, d.semantic_status as semanticStatus,
          COUNT(dc.id) as chunkCount FROM documents d
          LEFT JOIN document_chunks dc ON dc.document_id = d.id AND d.active_index_batch_id = dc.batch_id
          WHERE d.id = ? AND EXISTS (SELECT 1 FROM doc_knowledge_mappings m
            WHERE m.document_id = d.id AND m.knowledge_base_id = ?) GROUP BY d.id`,
        [documentId, knowledgeBaseId]
      );

      return { chunkCount: (result?.[0]?.chunkCount as number) || 0,
        lexicalStatus: String(result?.[0]?.lexicalStatus || 'pending'),
        semanticStatus: String(result?.[0]?.semanticStatus || 'pending') };
    } catch (error) {
      console.error(`获取文档统计失败 (KB: ${knowledgeBaseId}, Doc: ${documentId}):`, error);
      return { chunkCount: 0, lexicalStatus: 'failed', semanticStatus: 'failed' };
    }
  },

  /**
   * 获取知识库中的文档数量
   */
  async getDocumentCount(knowledgeBaseId: string): Promise<number> {
    try {
      const stats = await this.getKnowledgeBaseStats(knowledgeBaseId);
      return stats.documentCount;
    } catch (error) {
      console.error(`获取知识库文档数量失败 (ID: ${knowledgeBaseId}):`, error);
      return 0;
    }
  },

  /**
   * 获取知识库中的文档（包含文档详情）
   */
  async getDocumentsInKnowledgeBase(knowledgeBaseId: string): Promise<Array<{
    mapping: any; // DocKnowledgeMapping类型
    document: any;
  }>> {
    try {
      // 获取映射关系
      const mappings = await this.getKnowledgeBaseDocuments(knowledgeBaseId);
      
      // 获取每个文档的详细信息
      const documentsWithDetails = await Promise.all(
        mappings.map(async (mapping) => {
          try {
            // 使用UnifiedFileService获取文档
            const { UnifiedFileService } = await import('./unifiedFileService');
            let document = await UnifiedFileService.getFile(mapping.documentId);
            
            if (!document) {
              // 如果UnifiedFileService中没有，从数据库获取
                             const dbService = getDatabaseService();
               const dbManager = dbService.getDbManager();
              
              const docResult = await dbManager.select(
                "SELECT * FROM documents WHERE id = ?",
                [mapping.documentId]
              );

              if (docResult && docResult.length > 0) {
                const row = docResult[0];
                document = {
                  id: row.id,
                  name: row.title, // 从数据库的title映射到UnifiedFile的name
                  filePath: row.file_path,
                  fileType: row.file_type,
                  fileSize: row.file_size,
                  sizeFormatted: `${(row.file_size / 1024).toFixed(2)} KB`,
                  createdAt: new Date(row.created_at).toISOString(),
                  updatedAt: new Date(row.updated_at).toISOString(),
                  source: 'import' as const,
                  tags: row.tags ? JSON.parse(row.tags) : [],
                  isIndexed: row.is_indexed === 1,
                };
              }
            }
            
            return {
              mapping,
              document: document || {
                id: mapping.documentId,
                name: '未知文档',
                filePath: '',
                fileType: 'unknown',
                fileSize: 0,
                createdAt: new Date(mapping.indexedAt).toISOString(),
                updatedAt: new Date(mapping.indexedAt).toISOString(),
                tags: [],
                isIndexed: false,
              }
            };
          } catch (docError) {
            console.error(`获取文档详情失败 (ID: ${mapping.documentId}):`, docError);
            return {
              mapping,
              document: {
                id: mapping.documentId,
                name: '文档加载失败',
                filePath: '',
                fileType: 'unknown',
                fileSize: 0,
                sizeFormatted: '0 B',
                createdAt: new Date(mapping.indexedAt).toISOString(),
                updatedAt: new Date(mapping.indexedAt).toISOString(),
                source: 'import' as const,
                tags: [],
                isIndexed: false,
              }
            };
          }
        })
      );
      
      return documentsWithDetails;
    } catch (error) {
      console.error(`获取知识库文档失败 (ID: ${knowledgeBaseId}):`, error);
      return [];
    }
  },

  /**
   * 测试移除文档功能（用于验证数据库操作）
   */
  async testRemoveDocument(): Promise<{ success: boolean; message: string; details: string[] }> {
    const details: string[] = [];
    
    try {
      details.push('开始测试移除文档功能...');
      
      // 1. 获取一个现有的知识库
      const knowledgeBases = await this.getAllKnowledgeBases();
      if (knowledgeBases.length === 0) {
        return {
          success: false,
          message: '没有可用的知识库进行测试',
          details: [...details, '需要先创建知识库和添加文档']
        };
      }
      
      const testKb = knowledgeBases[0];
      details.push(`使用知识库: ${testKb.name} (${testKb.id})`);
      
      // 2. 获取该知识库中的文档
      const documents = await this.getKnowledgeBaseDocuments(testKb.id);
      if (documents.length === 0) {
        return {
          success: false,
          message: '知识库中没有文档进行测试',
          details: [...details, '需要先向知识库添加文档']
        };
      }
      
      const testDoc = documents[0];
      details.push(`测试文档: ${testDoc.documentId}`);
      
      // 3. 获取统计信息
      const stats = await this.getKnowledgeBaseStats(testKb.id);
      details.push(`发现 ${stats.chunkCount} 个知识片段`);
      details.push(`发现 ${stats.documentCount} 个映射关系`);
      
      // 4. 测试基本操作
      const docExists = await getDatabaseService().getKnowledgeBaseRepository()
        .isDocumentInKnowledgeBase(testDoc.documentId, testKb.id);
      details.push(`文档存在性检查: ${docExists ? '存在' : '不存在'}`);
      
      return {
        success: true,
        message: '移除文档功能测试完成，数据库操作正常',
        details
      };
      
    } catch (error) {
      details.push(`测试失败: ${error instanceof Error ? error.message : '未知错误'}`);
      return {
        success: false,
        message: `移除文档功能测试失败: ${error instanceof Error ? error.message : '未知错误'}`,
        details
      };
    }
  },

  // 注意：旧的队列系统相关方法已被移除
  // 新架构使用Repository模式
};
