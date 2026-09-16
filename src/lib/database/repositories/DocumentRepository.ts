import { BaseRepository } from './BaseRepository';
import { DatabaseManager } from '../core/DatabaseManager';

/**
 * 数据库中的文档接口
 */
export interface Document {
  id: string;
  title: string;
  file_path: string;
  file_type: string;
  file_size: number;
  created_at: number;
  updated_at: number;
  tags?: string[];
  folder_path?: string;
  is_indexed?: boolean;
}

/**
 * 文档仓库类
 */
export class DocumentRepository extends BaseRepository<Document> {
  protected tableName = 'documents';
  protected primaryKey = 'id';

  constructor(dbManager: DatabaseManager) {
    super(dbManager);
  }

  /**
   * 创建文档记录
   */
  async createDocument(documentData: {
    id: string;
    title: string;
    file_path: string;
    file_type: string;
    file_size: number;
    tags?: string[];
    folder_path?: string;
  }): Promise<Document> {
    const now = Date.now();
    const document = {
      ...documentData,
      created_at: now,
      updated_at: now,
      is_indexed: false
    };

    // REPLACE deletes the existing row before inserting it. Because document
    // mappings use foreign keys, that would cascade and silently detach a
    // document from every knowledge base on a repeated import. Use an UPSERT
    // so the row identity and its relationships survive re-imports.
    await this.dbManager.execute(`
      INSERT INTO documents
      (id, title, file_path, file_type, file_size, created_at, updated_at, tags, folder_path, is_indexed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        file_path = excluded.file_path,
        file_type = excluded.file_type,
        file_size = excluded.file_size,
        updated_at = excluded.updated_at,
        tags = excluded.tags,
        folder_path = excluded.folder_path,
        is_indexed = excluded.is_indexed
    `, [
      document.id,
      document.title,
      document.file_path,
      document.file_type,
      document.file_size,
      document.created_at,
      document.updated_at,
      JSON.stringify(document.tags || []),
      document.folder_path || null,
      document.is_indexed ? 1 : 0
    ]);

    return document;
  }

  /**
   * 获取文档
   */
  async getDocument(id: string): Promise<Document | null> {
    const results = await this.dbManager.select(
      'SELECT * FROM documents WHERE id = ?',
      [id]
    );

    if (results.length === 0) {
      return null;
    }

    return this.mapToDocument(results[0]);
  }

  /**
   * 更新文档索引状态
   */
  async updateIndexStatus(id: string, isIndexed: boolean): Promise<void> {
    await this.dbManager.execute(
      'UPDATE documents SET is_indexed = ?, updated_at = ? WHERE id = ?',
      [isIndexed ? 1 : 0, Date.now(), id]
    );
  }

  /**
   * 检查文档是否存在
   */
  async exists(id: string): Promise<boolean> {
    const results = await this.dbManager.select(
      'SELECT 1 FROM documents WHERE id = ?',
      [id]
    );
    return results.length > 0;
  }

  /**
   * 获取所有文档
   */
  async getAllDocuments(): Promise<Document[]> {
    const results = await this.dbManager.select('SELECT * FROM documents ORDER BY created_at DESC');
    return results.map(row => this.mapToDocument(row));
  }

  /**
   * 删除文档
   */
  async deleteDocument(id: string): Promise<boolean> {
    return this.dbManager.executeTransaction(async (transaction) => {
      // vector_embeddings is not linked by a foreign key because its
      // document/knowledge-base identity lives in JSON metadata. Retire those
      // vectors explicitly before deleting the document row.
      await transaction.execute(
        `UPDATE vector_embeddings
            SET is_deleted = 1
          WHERE json_extract(metadata, '$.documentId') = ?`,
        [id],
      );
      await transaction.execute(
        `DELETE FROM retrieval_chunks_fts
          WHERE chunk_id IN (SELECT id FROM retrieval_chunks WHERE document_id = ?)`,
        [id],
      );
      await transaction.execute('DELETE FROM retrieval_chunks WHERE document_id = ?', [id]);
      await transaction.execute('DELETE FROM source_blocks WHERE document_id = ?', [id]);
      await transaction.execute('DELETE FROM knowledge_chunks WHERE document_id = ?', [id]);

      const result = await transaction.execute('DELETE FROM documents WHERE id = ?', [id]);
      return (result.rowsAffected ?? 0) > 0;
    });
  }

  /**
   * 清空所有文档记录
   */
  async clearAllDocuments(): Promise<void> {
    await this.dbManager.executeTransaction(async (transaction) => {
      await transaction.execute('UPDATE vector_embeddings SET is_deleted = 1');
      await transaction.execute('DELETE FROM retrieval_chunks_fts');
      await transaction.execute('DELETE FROM retrieval_chunks');
      await transaction.execute('DELETE FROM source_blocks');
      await transaction.execute('DELETE FROM knowledge_chunks');
      await transaction.execute('DELETE FROM documents');
    });
  }

  /**
   * 映射数据库记录到Document对象
   */
  private mapToDocument(record: any): Document {
    return {
      id: record.id,
      title: record.title,
      file_path: record.file_path,
      file_type: record.file_type,
      file_size: record.file_size,
      created_at: record.created_at,
      updated_at: record.updated_at,
      tags: record.tags ? JSON.parse(record.tags) : [],
      folder_path: record.folder_path,
      is_indexed: record.is_indexed === 1
    };
  }
}
