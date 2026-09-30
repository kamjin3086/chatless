import { BaseRepository, QueryCondition } from './BaseRepository';
import { DatabaseManager } from '../core/DatabaseManager';
import { Message } from '@/types/chat';

/**
 * 消息Repository
 * 负责消息相关的数据库操作
 */
export class MessageRepository extends BaseRepository<Message> {
  protected tableName = 'messages';
  protected primaryKey = 'id';

  constructor(dbManager: DatabaseManager) {
    super(dbManager);
  }

  /**
   * 创建新消息
   */
  async createMessage(
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    options: {
      status?: 'pending' | 'sending' | 'sent' | 'error' | 'loading' | 'aborted';
      model?: string;
      document_reference?: any;
      context_data?: string;
      knowledge_base_reference?: any;
      thinking_start_time?: number;
      thinking_duration?: number;
    } = {}
  ): Promise<Message> {
    this.validateRequiredFields({ conversationId, role, content }, ['conversationId', 'role', 'content']);

    const messageData = {
      id: this.generateId(),
      conversation_id: conversationId, // 使用数据库schema中的字段名
      role,
      content,
      status: options.status || 'pending',
      model: options.model,
      document_reference: options.document_reference,
      context_data: options.context_data,
      knowledge_base_reference: options.knowledge_base_reference,
      thinking_start_time: options.thinking_start_time,
      thinking_duration: options.thinking_duration
    } as any;

    const created = await this.create(messageData);
    return this.mapToMessage(created);
  }

  /**
   * 获取对话的所有消息
   */
  async getMessagesByConversation(conversationId: string): Promise<Message[]> {
    const sql = `
      SELECT 
        id, conversation_id, role, content, created_at, updated_at,
        status, model, document_reference, context_data, images,
        thinking_start_time, thinking_duration,
        knowledge_base_reference,
        segments,
        citations,
        version_group_id, version_index
      FROM messages 
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `;

    const messages = await this.executeRawQuery(sql, [conversationId]);
    return messages.map(msg => this.mapToMessage(msg));
  }

  /**
   * 更新消息内容
   */
  async updateMessage(
    messageId: string,
    updates: {
      content?: string;
      status?: 'pending' | 'sending' | 'sent' | 'error' | 'loading' | 'aborted';
      model?: string;
      thinking_start_time?: number;
      thinking_duration?: number;
      document_reference?: any;
      context_data?: string;
      knowledge_base_reference?: any;
      images?: string[];
      segments?: any;
      citations?: any;
    }
  ): Promise<Message> {
    // 确保引用字段被正确序列化
    const dbUpdates = { ...updates };
    if (dbUpdates.document_reference) {
      dbUpdates.document_reference = JSON.stringify(dbUpdates.document_reference);
    }
    if (dbUpdates.knowledge_base_reference) {
      dbUpdates.knowledge_base_reference = JSON.stringify(dbUpdates.knowledge_base_reference);
    }
    if (dbUpdates.images) {
      (dbUpdates as any).images = JSON.stringify(dbUpdates.images);
    }
    if ('segments' in dbUpdates) {
      (dbUpdates as any).segments = dbUpdates.segments ? JSON.stringify(dbUpdates.segments) : null;
    }
    if ('citations' in dbUpdates) {
      (dbUpdates as any).citations = dbUpdates.citations ? JSON.stringify(dbUpdates.citations) : null;
    }

    const updated = await this.update(messageId, dbUpdates as any);
    return this.mapToMessage(updated);
  }

  /**
   * 完成流式消息，并记录思考时间
   */
  async finalizeStreamedMessage(
    messageId: string,
    finalStatus: 'sent' | 'aborted' | 'error',
    finalContent?: string,
    model?: string,
    thinking_start_time?: number
  ): Promise<Message> {
    const updateData: any = {
      status: finalStatus
    };

    if (finalContent !== undefined) {
      updateData.content = finalContent;
    }

    if (model) {
      updateData.model = model;
    }

    // 如果有思考开始时间，计算思考持续时间
    if (thinking_start_time) {
      const thinking_duration = Math.floor((Date.now() - thinking_start_time) / 1000);
      updateData.thinking_duration = thinking_duration;
      updateData.thinking_start_time = thinking_start_time;
    }

    const updated = await this.update(messageId, updateData);
    return this.mapToMessage(updated);
  }

  /**
   * 删除消息
   */
  async deleteMessage(messageId: string): Promise<boolean> {
    return await this.delete(messageId);
  }

  /**
   * 删除对话的所有消息
   */
  async deleteMessagesByConversation(conversationId: string): Promise<number> {
    return await this.deleteMany([
      { field: 'conversation_id', operator: '=' as const, value: conversationId }
    ]);
  }

  /**
   * 获取消息统计信息
   */
  async getMessageStatistics(conversationId?: string): Promise<{
    totalMessages: number;
    userMessages: number;
    assistantMessages: number;
    pendingMessages: number;
    errorMessages: number;
  }> {
    const conditions = [];
    if (conversationId) {
      conditions.push({ field: 'conversation_id', operator: '=' as const, value: conversationId });
    }

    const allMessages = await this.findAll(conditions);

    const stats = {
      totalMessages: allMessages.length,
      userMessages: allMessages.filter(m => m.role === 'user').length,
      assistantMessages: allMessages.filter(m => m.role === 'assistant').length,
      pendingMessages: allMessages.filter(m => m.status === 'pending' || m.status === 'loading').length,
      errorMessages: allMessages.filter(m => m.status === 'error').length
    };

    return stats;
  }

  /**
   * 搜索消息
   */
  async searchMessages(query: string, conversationId?: string): Promise<Message[]> {
    let sql = `
      SELECT * FROM messages 
      WHERE content LIKE ?
    `;
    const params = [`%${query}%`];

    if (conversationId) {
      sql += ` AND conversation_id = ?`;
      params.push(conversationId);
    }

    sql += ` ORDER BY created_at DESC`;

    const messages = await this.dbManager.select(sql, params);
    return messages.map(msg => this.mapToMessage(msg));
  }

  /**
   * 获取最近的消息
   */
  async getRecentMessages(limit: number = 10, conversationId?: string): Promise<Message[]> {
    const conditions: QueryCondition[] = [];

    if (conversationId) {
      conditions.push({ field: 'conversation_id', operator: '=' as const, value: conversationId });
    }

    const messages = await this.findAll(
      conditions,
      [{ field: 'created_at', direction: 'DESC' }]
    );

    // 手动限制结果数量
    return messages.slice(0, limit).map(msg => this.mapToMessage(msg));
  }

  /**
   * 获取包含文档引用的消息
   */
  async getMessagesWithDocuments(conversationId?: string): Promise<Message[]> {
    let sql = `
      SELECT * FROM messages 
      WHERE document_reference IS NOT NULL AND document_reference != ''
    `;
    const params: any[] = [];

    if (conversationId) {
      sql += ` AND conversation_id = ?`;
      params.push(conversationId);
    }

    sql += ` ORDER BY created_at DESC`;

    const messages = await this.dbManager.select(sql, params);
    return messages.map(msg => this.mapToMessage(msg));
  }

  /**
   * 获取包含知识库引用的消息
   */
  async getMessagesWithKnowledgeBase(knowledgeBaseId?: string, conversationId?: string): Promise<Message[]> {
    let sql = `
      SELECT * FROM messages 
      WHERE knowledge_base_reference IS NOT NULL AND knowledge_base_reference != ''
    `;
    const params: any[] = [];

    if (knowledgeBaseId) {
      sql += ` AND JSON_EXTRACT(knowledge_base_reference, '$.id') = ?`;
      params.push(knowledgeBaseId);
    }

    if (conversationId) {
      sql += ` AND conversation_id = ?`;
      params.push(conversationId);
    }

    sql += ` ORDER BY created_at DESC`;

    const messages = await this.dbManager.select(sql, params);
    return messages.map(msg => this.mapToMessage(msg));
  }

  /**
   * 更新对话的updated_at时间戳
   */
  async touchConversation(conversationId: string): Promise<void> {
    await this.dbManager.execute(
      'UPDATE conversations SET updated_at = ? WHERE id = ?',
      [Date.now(), conversationId]
    );
  }

  /**
   * 获取包含指定文件名引用的最近消息
   */
  async getRecentDocumentReferences(limit: number = 5): Promise<{
    conversation_id: string;
    file_name: string;
    created_at: string;
  }[]> {
    const sql = `
      SELECT conversation_id, JSON_EXTRACT(document_reference, '$.fileName') AS file_name, created_at
      FROM messages
      WHERE document_reference IS NOT NULL AND document_reference != ''
      ORDER BY created_at DESC
      LIMIT ?
    `;
    const rows = await this.dbManager.select(sql, [limit]);
    return rows;
  }

  /**
   * 获取聊天中附加的文件列表
   */
  async getChatAttachedFiles(): Promise<Array<{
    conversation_id: string;
    fileName: string;
    fileSize: number;
    created_at: string;
  }>> {
    const sql = `
      SELECT 
        conversation_id,
        JSON_EXTRACT(document_reference, '$.fileName') as fileName,
        JSON_EXTRACT(document_reference, '$.fileSize') as fileSize,
        created_at
      FROM messages 
      WHERE document_reference IS NOT NULL 
        AND JSON_EXTRACT(document_reference, '$.fileName') IS NOT NULL
      ORDER BY created_at DESC
    `;

    const result = await this.executeRawQuery(sql, []);
    return result.map((row: any) => ({
      conversation_id: row.conversation_id,
      fileName: row.fileName.replace(/"/g, ''), // 移除JSON字符串的引号
      fileSize: parseInt(row.fileSize) || 0,
      created_at: row.created_at
    }));
  }

  /**
   * 将数据库记录映射为Message对象
   */
  private mapToMessage(record: any): Message {
    const message: any = {
      id: record.id,
      conversation_id: record.conversation_id,
      role: record.role,
      content: record.content,
      created_at: record.created_at,
      updated_at: record.updated_at,
      status: record.status,
      model: record.model,
      document_reference: this.parseJsonField(record.document_reference),
      context_data: record.context_data,
      thinking_start_time: record.thinking_start_time,
      thinking_duration: record.thinking_duration,
      knowledge_base_reference: this.parseJsonField(record.knowledge_base_reference),
      images: this.parseImagesField(record.images),
      segments: this.parseJsonField(record.segments),
      citations: this.parseJsonField(record.citations),
    };
    
    // 添加版本字段（如果存在）
    if (record.version_group_id !== undefined && record.version_group_id !== null) {
      message.version_group_id = record.version_group_id;
    }
    if (record.version_index !== undefined && record.version_index !== null) {
      message.version_index = record.version_index;
    }
    
    return message;
  }

  /**
   * 安全解析images字段
   */
  private parseImagesField(imagesData: any): string[] | undefined {
    if (!imagesData) return undefined;
    
    // 如果已经是数组，直接返回
    if (Array.isArray(imagesData)) return imagesData;
    
    // 如果是字符串，需要判断格式
    if (typeof imagesData === 'string') {
      // 如果是data URL格式（以'data:'开头），直接返回数组
      if (imagesData.startsWith('data:')) {
        return [imagesData];
      }
      
      // 如果是JSON格式的字符串，尝试解析
      if (imagesData.startsWith('[') || imagesData.startsWith('{')) {
        try {
          const parsed = JSON.parse(imagesData);
          return Array.isArray(parsed) ? parsed : [parsed];
        } catch (error) {
          void error;
          return undefined;
        }
      }
      
      // 其他情况，当作单个图片处理
      return [imagesData];
    }
    
    return undefined;
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
} 