import { BaseRepository } from './BaseRepository';
import { DatabaseManager } from '../core/DatabaseManager';

/**
 * 知识库类型定义
 */
export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  icon: string;
  isEncrypted: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * 文档-知识库映射关系
 */
export interface DocKnowledgeMapping {
  id: string;
  documentId: string;
  knowledgeBaseId: string;
  indexedAt: number;
  status: 'pending' | 'indexing' | 'indexed' | 'failed';
}

/**
 * 知识库Repository
 * 负责知识库相关的数据库操作
 */
export class KnowledgeBaseRepository extends BaseRepository<KnowledgeBase> {
  protected tableName = 'knowledge_bases';
  protected primaryKey = 'id';

  constructor(dbManager: DatabaseManager) {
    super(dbManager);
  }

  /**
   * 检查 vector_embeddings 表是否存在（兼容旧库/未索引知识库）
   */
  private async hasVectorEmbeddingsTable(): Promise<boolean> {
    try {
      const rows = await this.dbManager.select<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vector_embeddings'`
      );
      return Array.isArray(rows) && rows.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * 软删除与知识库关联的向量数据（表不存在时跳过）
   */
  private async softDeleteVectorsByKnowledgeBaseId(
    transaction: { execute: DatabaseManager['execute'] },
    knowledgeBaseId: string
  ): Promise<number> {
    if (!(await this.hasVectorEmbeddingsTable())) {
      console.warn('[KnowledgeBaseRepository] vector_embeddings 表不存在，跳过向量软删除');
      return 0;
    }
    const result = await transaction.execute(
      `UPDATE vector_embeddings SET is_deleted = 1
       WHERE json_extract(metadata, '$.knowledgeBaseId') = ?`,
      [knowledgeBaseId]
    );
    return result.rowsAffected ?? 0;
  }

  /**
   * 创建知识库
   */
  async createKnowledgeBase(
    name: string,
    description: string,
    icon: string = 'database',
    isEncrypted: boolean = false
  ): Promise<KnowledgeBase> {
    this.validateRequiredFields({ name }, ['name']);

    const knowledgeBaseData = {
      id: this.generateId(),
      name,
      description: description || '',
      icon,
      is_encrypted: isEncrypted  // 使用数据库字段名
    } as any;

    const created = await this.create(knowledgeBaseData);
    return this.mapToKnowledgeBase(created);
  }

  /**
   * 获取所有知识库
   */
  async getAllKnowledgeBases(): Promise<KnowledgeBase[]> {
    const knowledgeBases = await this.findAll(
      undefined,
      [{ field: 'updated_at', direction: 'DESC' }]
    );

    return knowledgeBases.map(kb => this.mapToKnowledgeBase(kb));
  }

  /**
   * 根据ID获取知识库
   */
  async getKnowledgeBaseById(id: string): Promise<KnowledgeBase | null> {
    const knowledgeBase = await this.findById(id);
    return knowledgeBase ? this.mapToKnowledgeBase(knowledgeBase) : null;
  }

  /**
   * 更新知识库
   */
  async updateKnowledgeBase(
    id: string,
    updates: {
      name?: string;
      description?: string;
      icon?: string;
      isEncrypted?: boolean;
    }
  ): Promise<KnowledgeBase> {
    // 转换字段名到数据库格式
    const dbUpdates: any = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.description !== undefined) dbUpdates.description = updates.description;
    if (updates.icon !== undefined) dbUpdates.icon = updates.icon;
    if (updates.isEncrypted !== undefined) dbUpdates.is_encrypted = updates.isEncrypted;

    const updated = await this.update(id, dbUpdates);
    return this.mapToKnowledgeBase(updated);
  }

  /**
   * 删除知识库
   */
  async deleteKnowledgeBase(id: string): Promise<boolean> {
    console.log(`[deleteKnowledgeBase] 开始删除知识库: ${id}`);

    return await this.executeTransaction(async (transaction) => {
      // 1. 删除向量嵌入数据（软删除，表不存在时跳过）
      const vectorsAffected = await this.softDeleteVectorsByKnowledgeBaseId(transaction, id);
      console.log(`[deleteKnowledgeBase] 标记删除向量数据: ${vectorsAffected} 条`);

      // 2. 删除知识片段
      const chunksResult = await transaction.execute(
        'DELETE FROM knowledge_chunks WHERE knowledge_base_id = ?',
        [id]
      );
      console.log(`[deleteKnowledgeBase] 删除知识片段: ${chunksResult.rowsAffected} 条`);

      // 清理新检索链路的原文块、FTS 行和检索分块，避免删除知识库后
      // 残留结果仍能被全文检索命中。迁移在数据库服务初始化时完成。
      await transaction.execute(
        `DELETE FROM retrieval_chunks_fts
          WHERE chunk_id IN (SELECT id FROM retrieval_chunks WHERE knowledge_base_id = ?)`,
        [id],
      );
      await transaction.execute('DELETE FROM retrieval_chunks WHERE knowledge_base_id = ?', [id]);
      await transaction.execute('DELETE FROM source_blocks WHERE knowledge_base_id = ?', [id]);

      // 3. 删除文档映射
      const mappingResult = await transaction.execute(
        'DELETE FROM doc_knowledge_mappings WHERE knowledge_base_id = ?',
        [id]
      );
      console.log(`[deleteKnowledgeBase] 删除文档映射: ${mappingResult.rowsAffected} 条`);

      // 4. 删除知识库
      const result = await transaction.execute(
        'DELETE FROM knowledge_bases WHERE id = ?',
        [id]
      );
      console.log(`[deleteKnowledgeBase] 删除知识库记录: ${result.rowsAffected} 条`);

      console.log(`[deleteKnowledgeBase] 删除完成: vectors=${vectorsAffected}, chunks=${chunksResult.rowsAffected}, mapping=${mappingResult.rowsAffected}, kb=${result.rowsAffected}`);

      return result.rowsAffected > 0;
    });
  }

  /**
   * 清理孤立的向量数据
   * 删除那些没有对应knowledge_chunks记录的向量数据
   */
  async cleanupOrphanedVectors(): Promise<number> {
    try {
      console.log('[cleanupOrphanedVectors] 开始清理孤立的向量数据...');

      // 找出孤立的向量数据（没有对应的knowledge_chunks记录）
      const orphanedVectors = await this.dbManager.select(`
        SELECT ve.id
        FROM vector_embeddings ve
        LEFT JOIN knowledge_chunks kc ON
          json_extract(ve.metadata, '$.documentId') = kc.document_id AND
          json_extract(ve.metadata, '$.knowledgeBaseId') = kc.knowledge_base_id
        WHERE kc.id IS NULL AND ve.is_deleted = 0
      `);

      if (orphanedVectors.length === 0) {
        console.log('[cleanupOrphanedVectors] 没有找到孤立的向量数据');
        return 0;
      }

      console.log(`[cleanupOrphanedVectors] 发现 ${orphanedVectors.length} 个孤立的向量数据`);

      // 软删除孤立的向量数据
      const vectorIds = orphanedVectors.map(v => v.id);
      const placeholders = vectorIds.map(() => '?').join(',');

      const result = await this.dbManager.execute(
        `UPDATE vector_embeddings SET is_deleted = 1 WHERE id IN (${placeholders})`,
        vectorIds
      );

      console.log(`[cleanupOrphanedVectors] 清理完成，标记删除 ${result.rowsAffected} 个孤立向量`);
      return result.rowsAffected;
    } catch (error) {
      console.error('[cleanupOrphanedVectors] 清理失败:', error);
      throw error;
    }
  }

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
      // 总向量数
      const totalResult = await this.dbManager.select('SELECT COUNT(*) as count FROM vector_embeddings');
      const totalVectors = totalResult[0]?.count || 0;

      // 活跃向量数
      const activeResult = await this.dbManager.select('SELECT COUNT(*) as count FROM vector_embeddings WHERE is_deleted = 0');
      const activeVectors = activeResult[0]?.count || 0;

      // 已删除向量数
      const deletedVectors = totalVectors - activeVectors;

      // 孤立向量数（活跃但没有对应knowledge_chunks的向量）
      const orphanedResult = await this.dbManager.select(`
        SELECT COUNT(*) as count
        FROM vector_embeddings ve
        LEFT JOIN knowledge_chunks kc ON
          json_extract(ve.metadata, '$.documentId') = kc.document_id AND
          json_extract(ve.metadata, '$.knowledgeBaseId') = kc.knowledge_base_id
        WHERE kc.id IS NULL AND ve.is_deleted = 0
      `);
      const orphanedVectors = orphanedResult[0]?.count || 0;

      return {
        totalVectors,
        activeVectors,
        deletedVectors,
        orphanedVectors
      };
    } catch (error) {
      console.error('[getVectorStats] 获取统计信息失败:', error);
      return {
        totalVectors: 0,
        activeVectors: 0,
        deletedVectors: 0,
        orphanedVectors: 0
      };
    }
  }

  /**
   * 获取知识库统计信息
   */
  async getKnowledgeBaseStats(knowledgeBaseId: string): Promise<{
    documentCount: number;
    chunkCount: number;
  }> {
    const stats = await this.dbManager.select(`
      SELECT
        (SELECT COUNT(*) FROM doc_knowledge_mappings WHERE knowledge_base_id = ?) as documentCount,
        (SELECT COUNT(*) FROM knowledge_chunks WHERE knowledge_base_id = ?) as chunkCount
    `, [knowledgeBaseId, knowledgeBaseId]);

    return stats[0] || { documentCount: 0, chunkCount: 0 };
  }

  /**
   * 搜索知识库
   */
  async searchKnowledgeBases(query: string): Promise<KnowledgeBase[]> {
    const knowledgeBases = await this.dbManager.select(`
      SELECT * FROM knowledge_bases
      WHERE name LIKE ? OR description LIKE ?
      ORDER BY updated_at DESC
    `, [`%${query}%`, `%${query}%`]);

    return knowledgeBases.map(kb => this.mapToKnowledgeBase(kb));
  }

  // === 文档映射相关方法 ===

  /**
   * 添加文档到知识库
   */
  async addDocumentToKnowledgeBase(
    documentId: string,
    knowledgeBaseId: string,
    status: 'pending' | 'indexing' | 'indexed' | 'failed' = 'pending'
  ): Promise<DocKnowledgeMapping> {
    // 尝试确保文档在数据库中存在
    try {
      const { DocumentSyncService } = await import('../../services/documentSync');
      const ensured = await DocumentSyncService.ensureDocumentInDatabase(documentId);

      if (!ensured) {
        throw new Error(`文档不存在且无法同步: ${documentId}`);
      }
    } catch (importError) {
      console.warn('无法导入DocumentSyncService，跳过自动同步:', importError);

      // 验证文档是否存在
      const documentExists = await this.dbManager.select(
        'SELECT id FROM documents WHERE id = ?',
        [documentId]
      );

      if (documentExists.length === 0) {
        throw new Error(`文档不存在: ${documentId}`);
      }
    }

    // 验证知识库是否存在
    const knowledgeBaseExists = await this.dbManager.select(
      'SELECT id FROM knowledge_bases WHERE id = ?',
      [knowledgeBaseId]
    );

    if (knowledgeBaseExists.length === 0) {
      throw new Error(`知识库不存在: ${knowledgeBaseId}`);
    }

    // 检查映射是否已存在
    const existingMapping = await this.dbManager.select(
      'SELECT id FROM doc_knowledge_mappings WHERE document_id = ? AND knowledge_base_id = ?',
      [documentId, knowledgeBaseId]
    );

    if (existingMapping.length > 0) {
      // 如果映射已存在，更新状态并返回
      await this.dbManager.execute(
        'UPDATE doc_knowledge_mappings SET status = ?, indexed_at = ? WHERE document_id = ? AND knowledge_base_id = ?',
        [status, Date.now(), documentId, knowledgeBaseId]
      );

      const updatedMapping = await this.dbManager.select(
        'SELECT * FROM doc_knowledge_mappings WHERE document_id = ? AND knowledge_base_id = ?',
        [documentId, knowledgeBaseId]
      );

      return this.mapToDocMapping(updatedMapping[0]);
    }

    const mappingData = {
      id: this.generateId(),
      document_id: documentId,
      knowledge_base_id: knowledgeBaseId,
      indexed_at: Date.now(),
      status
    };

    await this.dbManager.execute(`
      INSERT INTO doc_knowledge_mappings
      (id, document_id, knowledge_base_id, indexed_at, status)
      VALUES (?, ?, ?, ?, ?)
    `, [
      mappingData.id,
      mappingData.document_id,
      mappingData.knowledge_base_id,
      mappingData.indexed_at,
      mappingData.status
    ]);

    // 更新知识库的更新时间
    await this.dbManager.execute(
      'UPDATE knowledge_bases SET updated_at = ? WHERE id = ?',
      [Date.now(), knowledgeBaseId]
    );

    return this.mapToDocMapping(mappingData);
  }

  /**
   * 从知识库移除文档
   */
  async removeDocumentFromKnowledgeBase(
    documentId: string,
    knowledgeBaseId: string
  ): Promise<boolean> {
    return await this.executeTransaction(async (transaction) => {
      console.log(`[removeDocumentFromKnowledgeBase] 开始删除文档: ${documentId} from ${knowledgeBaseId}`);

      let vectorsAffected = 0;
      if (await this.hasVectorEmbeddingsTable()) {
        const vectorsResult = await transaction.execute(
          `UPDATE vector_embeddings SET is_deleted = 1
           WHERE json_extract(metadata, '$.documentId') = ?
           AND json_extract(metadata, '$.knowledgeBaseId') = ?`,
          [documentId, knowledgeBaseId]
        );
        vectorsAffected = vectorsResult.rowsAffected ?? 0;
      }
      console.log(`[removeDocumentFromKnowledgeBase] 标记删除向量数据: ${vectorsAffected} 条`);

      // 2. 删除知识片段
      const chunksResult = await transaction.execute(
        'DELETE FROM knowledge_chunks WHERE document_id = ? AND knowledge_base_id = ?',
        [documentId, knowledgeBaseId]
      );
      console.log(`[removeDocumentFromKnowledgeBase] 删除知识片段: ${chunksResult.rowsAffected} 条`);

      await transaction.execute(
        `DELETE FROM retrieval_chunks_fts
          WHERE chunk_id IN (
            SELECT id FROM retrieval_chunks
             WHERE document_id = ? AND knowledge_base_id = ?
          )`,
        [documentId, knowledgeBaseId],
      );
      await transaction.execute(
        'DELETE FROM retrieval_chunks WHERE document_id = ? AND knowledge_base_id = ?',
        [documentId, knowledgeBaseId],
      );
      await transaction.execute(
        'DELETE FROM source_blocks WHERE document_id = ? AND knowledge_base_id = ?',
        [documentId, knowledgeBaseId],
      );

      // 3. 删除映射关系
      const mappingResult = await transaction.execute(
        'DELETE FROM doc_knowledge_mappings WHERE document_id = ? AND knowledge_base_id = ?',
        [documentId, knowledgeBaseId]
      );
      console.log(`[removeDocumentFromKnowledgeBase] 删除映射关系: ${mappingResult.rowsAffected} 条`);

      // 4. 更新知识库的更新时间
      await transaction.execute(
        'UPDATE knowledge_bases SET updated_at = ? WHERE id = ?',
        [Date.now(), knowledgeBaseId]
      );

      console.log(`[removeDocumentFromKnowledgeBase] 删除完成: vectors=${vectorsAffected}, chunks=${chunksResult.rowsAffected}, mapping=${mappingResult.rowsAffected}`);

      return (mappingResult.rowsAffected ?? 0) > 0 || (chunksResult.rowsAffected ?? 0) > 0;
    });
  }

  /**
   * 获取知识库中的文档映射
   */
  async getKnowledgeBaseDocuments(knowledgeBaseId: string): Promise<DocKnowledgeMapping[]> {
    const mappings = await this.dbManager.select(`
      SELECT * FROM doc_knowledge_mappings
      WHERE knowledge_base_id = ?
      ORDER BY indexed_at DESC
    `, [knowledgeBaseId]);

    return mappings.map(mapping => this.mapToDocMapping(mapping));
  }

  /**
   * 获取文档所属的知识库
   */
  async getDocumentKnowledgeBases(documentId: string): Promise<DocKnowledgeMapping[]> {
    const mappings = await this.dbManager.select(`
      SELECT * FROM doc_knowledge_mappings
      WHERE document_id = ?
      ORDER BY indexed_at DESC
    `, [documentId]);

    return mappings.map(mapping => this.mapToDocMapping(mapping));
  }

  /**
   * 更新文档映射状态
   */
  async updateDocumentMappingStatus(
    documentId: string,
    knowledgeBaseId: string,
    status: 'pending' | 'indexing' | 'indexed' | 'failed'
  ): Promise<void> {
    await this.dbManager.execute(`
      UPDATE doc_knowledge_mappings
      SET status = ?, indexed_at = ?
      WHERE document_id = ? AND knowledge_base_id = ?
    `, [status, Date.now(), documentId, knowledgeBaseId]);
  }

  /**
   * 检查文档是否在知识库中
   */
  async isDocumentInKnowledgeBase(
    documentId: string,
    knowledgeBaseId: string
  ): Promise<boolean> {
    const mappings = await this.dbManager.select(`
      SELECT id FROM doc_knowledge_mappings
      WHERE document_id = ? AND knowledge_base_id = ?
    `, [documentId, knowledgeBaseId]);

    return mappings.length > 0;
  }

  // === 知识片段相关方法 ===

  /**
   * 创建知识片段
   */
  async createKnowledgeChunk(
    knowledgeBaseId: string,
    documentId: string,
    content: string,
    metadata: any = {},
    chunkIndex: number = 0
  ): Promise<string> {
    const id = this.generateId();
    const contentHash = await this.generateContentHash(content);

    await this.dbManager.execute(`
      INSERT INTO knowledge_chunks (
        id, knowledge_base_id, document_id, content, chunk_index, content_hash, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      knowledgeBaseId,
      documentId,
      content,
      chunkIndex,
      contentHash,
      JSON.stringify(metadata),
      Date.now()
    ]);

    return id;
  }

  /**
   * 获取知识库的所有知识片段
   */
  async getKnowledgeChunks(knowledgeBaseId: string): Promise<any[]> {
    return await this.dbManager.select(`
      SELECT * FROM knowledge_chunks
      WHERE knowledge_base_id = ?
      ORDER BY document_id, chunk_index
    `, [knowledgeBaseId]);
  }

  /**
   * 删除知识片段
   */
  async deleteKnowledgeChunks(
    knowledgeBaseId?: string,
    documentId?: string
  ): Promise<number> {
    let sql = 'DELETE FROM knowledge_chunks WHERE 1=1';
    const params: any[] = [];

    if (knowledgeBaseId) {
      sql += ' AND knowledge_base_id = ?';
      params.push(knowledgeBaseId);
    }

    if (documentId) {
      sql += ' AND document_id = ?';
      params.push(documentId);
    }

    const result = await this.dbManager.execute(sql, params);
    return result.rowsAffected;
  }

  /**
   * 将数据库记录映射为KnowledgeBase对象
   */
  private mapToKnowledgeBase(record: any): KnowledgeBase {
    return {
      id: record.id,
      name: record.name,
      description: record.description || '',
      icon: record.icon || 'database',
      isEncrypted: Boolean(record.is_encrypted),
      createdAt: record.created_at,
      updatedAt: record.updated_at
    };
  }

  /**
   * 将数据库记录映射为DocKnowledgeMapping对象
   */
  private mapToDocMapping(record: any): DocKnowledgeMapping {
    return {
      id: record.id,
      documentId: record.document_id,
      knowledgeBaseId: record.knowledge_base_id,
      indexedAt: record.indexed_at,
      status: record.status as 'pending' | 'indexing' | 'indexed' | 'failed'
    };
  }

  /**
   * 生成内容哈希
   */
  private async generateContentHash(content: string): Promise<string> {
    // 简单的哈希实现，实际项目中可能需要更强的哈希算法
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `kb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
