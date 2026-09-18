import { BaseRepository } from './BaseRepository';
import { DatabaseManager } from '../core/DatabaseManager';
import { Conversation } from '@/types/chat';

/**
 * 对话Repository
 * 负责对话相关的数据库操作
 */
export class ConversationRepository extends BaseRepository<Conversation> {
  protected tableName = 'conversations';
  protected primaryKey = 'id';

  constructor(dbManager: DatabaseManager) {
    super(dbManager);
    this.validateRequiredFields = this.validateRequiredFields.bind(this);
  }

  /**
   * 创建新对话
   */
  async createConversation(
    title: string,
    modelId: string,
    options: {
      is_important?: boolean;
      is_favorite?: boolean;
      model_provider?: string;
    } = {}
  ): Promise<Conversation> {
    this.validateRequiredFields({ title, modelId }, ['title', 'modelId']);

    const conversationData = {
      id: this.generateId(),
      title,
      model_id: modelId, // 使用数据库schema中的字段名
      model_provider: options.model_provider,
      model_full_id: options.model_provider ? `${options.model_provider}/${modelId}` : modelId,
      is_important: options.is_important || false,
      is_favorite: options.is_favorite || false
    } as any;

    const created = await this.create(conversationData);
    return this.mapToConversation(created);
  }

  /**
   * 获取所有对话（按更新时间倒序）
   */
  async getAllConversations(): Promise<Conversation[]> {
    const conversations = await this.findAll(
      undefined,
      [{ field: 'updated_at', direction: 'DESC' }]
    );

    return conversations.map(conv => this.mapToConversation(conv));
  }

  /**
   * 获取对话（包含消息）
   */
  async getConversationWithMessages(conversationId: string): Promise<Conversation | null> {
    const conversation = await this.findById(conversationId);
    if (!conversation) {
      return null;
    }

    // 获取消息
    const messages = await this.dbManager.select(`
      SELECT 
        id, conversation_id, role, content, created_at, updated_at,
        status, model, document_reference, context_data, images,
        thinking_start_time, thinking_duration,
        knowledge_base_reference
      FROM messages 
      WHERE conversation_id = ? 
      ORDER BY created_at ASC
    `, [conversationId]);

    // 处理消息数据
    const processedMessages = messages.map(msg => ({
      id: msg.id,
      conversation_id: msg.conversation_id,
      role: msg.role,
      content: msg.content,
      created_at: msg.created_at,
      updated_at: msg.updated_at,
      status: msg.status,
      model: msg.model,
      document_reference: this.parseJsonField(msg.document_reference),
      context_data: msg.context_data,
      thinking_start_time: msg.thinking_start_time,
      thinking_duration: msg.thinking_duration,
      knowledge_base_reference: this.parseJsonField(msg.knowledge_base_reference),
      images: msg.images ? JSON.parse(msg.images) : undefined
    }));

    return {
      ...this.mapToConversation(conversation),
      messages: processedMessages
    };
  }

  /**
   * 更新对话标题
   */
  async updateTitle(conversationId: string, title: string): Promise<Conversation> {
    this.validateRequiredFields({ title }, ['title']);
    
    const updated = await this.update(conversationId, { title });
    return this.mapToConversation(updated);
  }

  /**
   * 切换重要标记
   */
  async toggleImportant(conversationId: string): Promise<Conversation> {
    const conversation = await this.findById(conversationId);
    if (!conversation) {
      throw this.createNotFoundError(conversationId);
    }

    const newImportantStatus = conversation.is_important;
    const updated = await this.update(conversationId, { 
      is_important: !newImportantStatus 
    } as any);

    return this.mapToConversation(updated);
  }

  /**
   * 切换收藏标记
   */
  async toggleFavorite(conversationId: string): Promise<Conversation> {
    const conversation = await this.findById(conversationId);
    if (!conversation) {
      throw this.createNotFoundError(conversationId);
    }

    const newFavoriteStatus = conversation.is_favorite;
    const updated = await this.update(conversationId, { 
      is_favorite: !newFavoriteStatus 
    } as any);

    return this.mapToConversation(updated);
  }

  /**
   * 删除对话（级联删除消息）
   */
  async deleteConversation(conversationId: string): Promise<boolean> {
    return await this.executeTransaction(async (transaction) => {
      // 先删除消息
      await transaction.execute(
        'DELETE FROM messages WHERE conversation_id = ?',
        [conversationId]
      );

      // 再删除对话
      const result = await transaction.execute(
        'DELETE FROM conversations WHERE id = ?',
        [conversationId]
      );

      return result.rowsAffected > 0;
    });
  }

  /**
   * 复制对话
   */
  async duplicateConversation(conversationId: string): Promise<Conversation | null> {
    const originalConversation = await this.getConversationWithMessages(conversationId);
    if (!originalConversation) return null;

    return await this.executeTransaction(async (transaction) => {
      // 创建新对话
      const newConversationId = this.generateId();
      const newTitle = `clone of ${originalConversation.title}`;
      
      await transaction.execute(`
        INSERT INTO conversations (id, title, created_at, updated_at, model_id, is_important, is_favorite)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        newConversationId,
        newTitle,
        Date.now(),
        Date.now(),
        originalConversation.model_id,
        originalConversation.is_important ? 1 : 0,
        originalConversation.is_favorite ? 1 : 0
      ]);

      // 复制消息
      if (originalConversation.messages && originalConversation.messages.length > 0) {
        for (const message of originalConversation.messages) {
          const newMessageId = this.generateId();
          await transaction.execute(`
            INSERT INTO messages (
              id, conversation_id, role, content, created_at, updated_at, 
              status, model, document_reference, context_data, knowledge_base_reference, thinking_start_time, thinking_duration
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            newMessageId,
            newConversationId,
            message.role,
            message.content,
            message.created_at,
            message.updated_at,
            message.status,
            message.model,
            message.document_reference ? JSON.stringify(message.document_reference) : null,
            message.context_data,
            message.knowledge_base_reference ? JSON.stringify(message.knowledge_base_reference) : null,
            (message as any).thinking_start_time || null,
            message.thinking_duration || null
          ]);
        }
      }

      // 返回新对话
      const newConversation = await this.findById(newConversationId);
      return newConversation ? this.mapToConversation(newConversation) : null;
    });
  }

  /**
   * 获取对话统计信息
   */
  async getStatistics(): Promise<{
    totalConversations: number;
    importantConversations: number;
    favoriteConversations: number;
    totalMessages: number;
  }> {
    const stats = await this.dbManager.select(`
      SELECT 
        COUNT(*) as totalConversations,
        SUM(CASE WHEN is_important = 1 THEN 1 ELSE 0 END) as importantConversations,
        SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END) as favoriteConversations,
        (SELECT COUNT(*) FROM messages) as totalMessages
      FROM conversations
    `);

    return stats[0] || {
      totalConversations: 0,
      importantConversations: 0,
      favoriteConversations: 0,
      totalMessages: 0
    };
  }

  /**
   * 搜索对话
   */
  async searchConversations(query: string): Promise<Conversation[]> {
    const conversations = await this.dbManager.select(`
      SELECT DISTINCT c.*
      FROM conversations c
      LEFT JOIN messages m ON c.id = m.conversation_id
      WHERE c.title LIKE ? OR m.content LIKE ?
      ORDER BY c.updated_at DESC
    `, [`%${query}%`, `%${query}%`]);

    return conversations.map(conv => this.mapToConversation(conv));
  }

  /**
   * 清空所有对话
   */
  async clearAllConversations(): Promise<void> {
    await this.executeTransaction(async (transaction) => {
      await transaction.execute('DELETE FROM messages');
      await transaction.execute('DELETE FROM conversations');
    });
  }

  /**
   * 将数据库记录映射为Conversation对象
   */
    private mapToConversation(record: any): Conversation {
    return {
      id: record.id,
      title: record.title,
      created_at: record.created_at,
      updated_at: record.updated_at,
      model_id: record.model_id,
      model_provider: record.model_provider,
      model_full_id: record.model_full_id,
      is_important: this.convertToBoolean(record.is_important),
      is_favorite: this.convertToBoolean(record.is_favorite),
      messages: record.messages || []
    };
  }

  /**
   * 将数据库值正确转换为布尔值
   */
  private convertToBoolean(value: any): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      // 字符串 "true" 返回 true，其他字符串返回 false
      return value.toLowerCase() === 'true';
    }
    if (typeof value === 'number') {
      // 数字 1 返回 true，其他数字返回 false
      return value === 1;
    }
    // 其他类型（null, undefined 等）返回 false
    return false;
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 创建未找到错误
   */
  private createNotFoundError(id: string): Error {
    return new Error(`对话不存在: ${id}`);
  }
}
