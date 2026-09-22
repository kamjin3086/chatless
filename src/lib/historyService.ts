import { HistoryItem, HistoryFilter, HistoryGroup, HistoryStats } from '@/types/history';
import { Conversation, Message } from '@/types/chat';
import { format, isToday, isYesterday, isThisWeek, isThisMonth } from 'date-fns';
import { DatabaseService } from '@/lib/database/services/DatabaseService';

/**
 * 历史记录服务 - 重构版本
 * 使用新的DatabaseService替代旧的队列系统
 */
export class HistoryService {
  private static instance: HistoryService;
  
  public static getInstance(): HistoryService {
    if (!HistoryService.instance) {
      HistoryService.instance = new HistoryService();
    }
    return HistoryService.instance;
  }

  /**
   * 获取数据库服务实例
   */
  private getDatabaseService() {
    return DatabaseService.getInstance();
  }

  /**
   * 获取所有历史记录（使用Repository模式）
   */
  async getAllHistory(): Promise<HistoryItem[]> {
    try {
      const dbService = this.getDatabaseService();
      const conversationRepo = dbService.getConversationRepository();
      
      // 使用Repository获取对话列表
      const conversations = await conversationRepo.getAllConversations();
      
      // 转换为历史记录项
      const historyItems: HistoryItem[] = [];
      
      for (const conversation of conversations) {
        // 为每个对话获取消息统计信息
        const conversationWithMessages = await conversationRepo.getConversationWithMessages(conversation.id);
        const messages = conversationWithMessages?.messages || [];
        
        const historyItem = this.convertToHistoryItem({
          ...conversation,
          messageCount: messages.length,
          lastMessageTime: messages.length > 0
            ? Math.max(
                ...messages
                  .map(m => (m as any).createdAt ?? (m as any).created_at ?? 0)
              )
            : (conversation as any).updated_at,
          lastMessage: messages.length > 0 ? messages[messages.length - 1].content : '',
          firstUserMessage: messages.find(m => m.role === 'user')?.content || ''
        });
        
        historyItems.push(historyItem);
      }
      
      return historyItems;
    } catch (error) {
      console.error('获取历史记录失败:', error);
      return [];
    }
  }

  /**
   * 根据筛选条件获取历史记录
   */
  async getFilteredHistory(filter: HistoryFilter): Promise<HistoryItem[]> {
    try {
      const allHistory = await this.getAllHistory();
      
      return allHistory.filter(item => {
        // 日期筛选
        if (!this.matchesDateFilter(item, filter.dateRange)) {
          return false;
        }
        
        // 模型筛选
        if (filter.model && filter.model !== 'all' && item.model !== filter.model) {
          return false;
        }
        
        // 重要性筛选 - 确保正确的布尔值比较
        if (filter.isImportant !== undefined) {
          const itemIsImportant = Boolean(item.isImportant);
          if (itemIsImportant !== filter.isImportant) {
            return false;
          }
        }
        
        // 收藏筛选 - 确保正确的布尔值比较
        if (filter.isFavorite !== undefined) {
          const itemIsFavorite = Boolean(item.isFavorite);
          if (itemIsFavorite !== filter.isFavorite) {
            return false;
          }
        }
        
        // 标签筛选
        if (filter.tags && filter.tags.length > 0) {
          const hasMatchingTag = filter.tags.some(tag => 
            item.tags.some(itemTag => 
              itemTag.toLowerCase().includes(tag.toLowerCase())
            )
          );
          if (!hasMatchingTag) {
            return false;
          }
        }
        
        // 搜索查询 - 改进搜索逻辑
        if (filter.searchQuery && filter.searchQuery.trim()) {
          const query = filter.searchQuery.toLowerCase().trim();
          const searchableText = [
            item.title || '',
            item.summary || '',
            item.lastMessage || '',
            ...item.tags
          ].join(' ').toLowerCase();
          
          if (!searchableText.includes(query)) {
            return false;
          }
        }
        
        return true;
      });
    } catch (error) {
      console.error('筛选历史记录失败:', error);
      return [];
    }
  }

  /**
   * 按日期分组历史记录
   */
  async getGroupedHistory(filter: HistoryFilter = { dateRange: 'all' }): Promise<HistoryGroup[]> {
    try {
      const history = await this.getFilteredHistory(filter);
      const groups: Map<string, HistoryItem[]> = new Map();
      
      history.forEach(item => {
        const date = new Date(item.timestamp);
        let groupKey: string;
        let displayName: string;
        
        if (isToday(date)) {
          groupKey = 'today';
          displayName = '今天';
        } else if (isYesterday(date)) {
          groupKey = 'yesterday';
          displayName = '昨天';
        } else if (isThisWeek(date)) {
          groupKey = 'thisWeek';
          displayName = '本周';
        } else if (isThisMonth(date)) {
          groupKey = 'thisMonth';
          displayName = '本月';
        } else {
          groupKey = format(date, 'yyyy-MM');
          displayName = format(date, 'yyyy年MM月');
        }
        
        if (!groups.has(groupKey)) {
          groups.set(groupKey, []);
        }
        groups.get(groupKey)!.push(item);
      });
      
      // 转换为数组并排序
      const result: HistoryGroup[] = [];
      const sortOrder = ['today', 'yesterday', 'thisWeek', 'thisMonth'];
      
      // 先添加预定义的分组
      sortOrder.forEach(key => {
        if (groups.has(key)) {
          const items = groups.get(key)!;
          result.push({
            date: key,
            displayName: this.getDisplayName(key),
            items: items.sort((a, b) => b.timestamp - a.timestamp)
          });
          groups.delete(key);
        }
      });
      
      // 添加其他月份分组（按时间倒序）
      const remainingGroups = Array.from(groups.entries())
        .sort(([a], [b]) => b.localeCompare(a));
      
      remainingGroups.forEach(([key, items]) => {
        result.push({
          date: key,
          displayName: this.getDisplayName(key),
          items: items.sort((a, b) => b.timestamp - a.timestamp)
        });
      });
      
      return result;
    } catch (error) {
      console.error('分组历史记录失败:', error);
      return [];
    }
  }

  /**
   * 获取历史统计信息（使用Repository统计方法）
   */
  async getHistoryStats(): Promise<HistoryStats> {
    try {
      const dbService = this.getDatabaseService();
      const conversationRepo = dbService.getConversationRepository();
      
      // 使用Repository获取统计信息
      const repoStats = await conversationRepo.getStatistics();
      const history = await this.getAllHistory();
      
      const stats: HistoryStats = {
        totalConversations: repoStats.totalConversations,
        totalMessages: repoStats.totalMessages,
        favoriteCount: repoStats.favoriteConversations,
        importantCount: repoStats.importantConversations,
        modelUsage: {},
        tagsUsage: {}
      };
      
      // 统计模型使用情况
      history.forEach(item => {
        if (item.model) {
          stats.modelUsage[item.model] = (stats.modelUsage[item.model] || 0) + 1;
        }
      });
      
      // 统计标签使用情况
      history.forEach(item => {
        item.tags.forEach(tag => {
          stats.tagsUsage[tag] = (stats.tagsUsage[tag] || 0) + 1;
        });
      });
      
      return stats;
    } catch (error) {
      console.error('获取历史统计失败:', error);
      return {
        totalConversations: 0,
        totalMessages: 0,
        favoriteCount: 0,
        importantCount: 0,
        modelUsage: {},
        tagsUsage: {}
      };
    }
  }

  /**
   * 切换对话重要性标记
   */
  async toggleImportant(conversationId: string): Promise<boolean> {
    try {
      const dbService = this.getDatabaseService();
      const conversationRepo = dbService.getConversationRepository();

      // 获取当前状态
      const conversation = await conversationRepo.findById(conversationId);
      if (!conversation) {
        console.error('对话不存在:', conversationId);
        return false;
      }

      // 切换重要性状态
      const currentImportant = (conversation as any).is_important ?? (conversation as any).isImportant;
      await conversationRepo.update(conversationId, {
        is_important: !currentImportant
      } as any);

      return true;
    } catch (error) {
      console.error('切换重要性标记失败:', error);
      return false;
    }
  }

  /**
   * 切换对话收藏状态
   */
  async toggleFavorite(conversationId: string): Promise<boolean> {
    try {
      const dbService = this.getDatabaseService();
      const conversationRepo = dbService.getConversationRepository();

      // 获取当前状态
      const conversation = await conversationRepo.findById(conversationId);
      if (!conversation) {
        console.error('对话不存在:', conversationId);
        return false;
      }

      // 切换收藏状态
      const currentFavorite = (conversation as any).is_favorite ?? (conversation as any).isFavorite;
      await conversationRepo.update(conversationId, {
        is_favorite: !currentFavorite
      } as any);

      return true;
    } catch (error) {
      console.error('切换收藏状态失败:', error);
      return false;
    }
  }

  /**
   * 删除对话
   */
  async deleteConversation(conversationId: string): Promise<boolean> {
    try {
      // Anything the conversation started (a dev server, a watcher) must not
      // outlive it, or the port stays occupied and the process is unreachable.
      try {
        const { getProcessSandbox } = await import('@/lib/skills/sandbox');
        await getProcessSandbox().stopConversationProcesses(conversationId);
      } catch (error) {
        console.warn('[historyService] 停止会话后台进程失败:', error);
      }

      const dbService = this.getDatabaseService();
      const conversationRepo = dbService.getConversationRepository();

      // 使用Repository的删除方法，它会自动处理相关消息的删除
      await conversationRepo.delete(conversationId);
      
      return true;
    } catch (error) {
      console.error('删除对话失败:', error);
      return false;
    }
  }

  /**
   * 导出对话
   */
  async exportConversation(conversationId: string, format: 'json' | 'markdown' | 'txt' = 'json'): Promise<string | null> {
    try {
      const dbService = this.getDatabaseService();
      const conversationRepo = dbService.getConversationRepository();
      const messageRepo = dbService.getMessageRepository();

      // 获取对话信息
      const conversation = await conversationRepo.findById(conversationId);
      if (!conversation) {
        throw new Error('对话不存在');
      }

      // 获取消息
      const messages = await messageRepo.getMessagesByConversation(conversationId);

      switch (format) {
        case 'json':
          return JSON.stringify({ conversation, messages }, null, 2);
        case 'markdown':
          return this.exportToMarkdown(conversation, messages);
        case 'txt':
          return this.exportToText(conversation, messages);
        default:
          return JSON.stringify({ conversation, messages }, null, 2);
      }
    } catch (error) {
      console.error('导出对话失败:', error);
      return null;
    }
  }

  /**
   * 批量删除对话
   */
  async batchDeleteConversations(conversationIds: string[]): Promise<boolean> {
    try {
      const dbService = this.getDatabaseService();
      const conversationRepo = dbService.getConversationRepository();

      // 使用Promise.all并行删除，每个删除操作都会自动处理相关消息
      await Promise.all(
        conversationIds.map(id => conversationRepo.delete(id))
      );

      return true;
    } catch (error) {
      console.error('批量删除对话失败:', error);
      return false;
    }
  }

  // 私有方法

    private convertToHistoryItem(conv: any): HistoryItem {
    const summary = this.generateSummary(conv.firstUserMessage || conv.lastMessage || '');
    const tags = this.extractTags(conv.title, summary);
    
    return {
      id: conv.id,
      conversationId: conv.id,
      title: conv.title || '未命名对话',
      summary,
      model: conv.modelId || conv.model_id || '未知模型',
      tags,
      timestamp: conv.updatedAt || conv.updated_at || conv.createdAt || conv.created_at,
      fullTimestamp: format(new Date(conv.updatedAt || conv.updated_at || conv.createdAt || conv.created_at), 'yyyy-MM-dd HH:mm:ss'),
      isImportant: this.convertToBoolean(conv.isImportant || conv.is_important),
      isFavorite: this.convertToBoolean(conv.isFavorite || conv.is_favorite),
      messageCount: conv.messageCount || 0,
      lastMessage: conv.lastMessage || '',
      createdAt: conv.createdAt || conv.created_at,
      updatedAt: conv.updatedAt || conv.updated_at
    };
  }

  private generateSummary(content: string): string {
    if (!content) return '暂无内容';
    
    // 移除多余的空白字符
    const cleaned = content.replace(/\s+/g, ' ').trim();
    
    // 截取前150个字符作为摘要
    if (cleaned.length <= 150) {
      return cleaned;
    }
    
    return cleaned.substring(0, 150) + '...';
  }

  private extractTags(title: string, summary: string): string[] {
    const tags: string[] = [];
    const text = `${title} ${summary}`.toLowerCase();
    
    // 简单的关键词提取
    const keywords = [
      '编程', '代码', '开发', 'code', 'programming',
      '设计', 'design', 'ui', 'ux',
      '数据', 'data', '分析', 'analysis',
      '学习', 'learning', '教程', 'tutorial',
      '问题', 'problem', '解决', 'solution',
      '帮助', 'help', '支持', 'support'
    ];
    
    keywords.forEach(keyword => {
      if (text.includes(keyword) && !tags.includes(keyword)) {
        tags.push(keyword);
      }
    });
    
    return tags.slice(0, 5); // 最多5个标签
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

  private matchesDateFilter(item: HistoryItem, dateRange: string): boolean {
    const itemDate = new Date(item.timestamp);
    const now = new Date();
    
    switch (dateRange) {
      case 'today':
        return isToday(itemDate);
      case 'yesterday':
        return isYesterday(itemDate);
      case 'week':
        return isThisWeek(itemDate);
      case 'month':
        return isThisMonth(itemDate);
      case 'all':
      default:
        return true;
    }
  }

  private getDisplayName(key: string): string {
    const displayNames: Record<string, string> = {
      'today': '今天',
      'yesterday': '昨天',
      'thisWeek': '本周',
      'thisMonth': '本月'
    };
    
    if (displayNames[key]) {
      return displayNames[key];
    }
    
    // 对于年月格式，解析并格式化
    if (key.match(/^\d{4}-\d{2}$/)) {
      const [year, month] = key.split('-');
      return `${year}年${month}月`;
    }
    
    return key;
  }

  private exportToMarkdown(conversation: any, messages: any[]): string {
    const title = conversation.title || '未命名对话';
    const date = format(new Date(conversation.createdAt || conversation.created_at), 'yyyy-MM-dd HH:mm:ss');
    
    let markdown = `# ${title}\n\n`;
    markdown += `**创建时间**: ${date}\n\n`;
    markdown += `**模型**: ${conversation.modelId || conversation.model_id || '未知'}\n\n`;
    markdown += `---\n\n`;
    
    messages.forEach((message, index) => {
      const role = (message).role === 'user' ? '👤 用户' : '🤖 助手';
      const timestamp = format(new Date(message.createdAt || (message).created_at), 'HH:mm:ss');
      
      markdown += `## ${role} (${timestamp})\n\n`;
      markdown += `${message.content}\n\n`;
      if (message.images && message.images.length) {
        message.images.forEach((img: string) => {
          markdown += `![image](${img})\n\n`;
        });
      }
      
      if (index < messages.length - 1) {
        markdown += `---\n\n`;
      }
    });
    
    return markdown;
  }

  private exportToText(conversation: any, messages: any[]): string {
    const title = conversation.title || '未命名对话';
    const date = format(new Date(conversation.createdAt || conversation.created_at), 'yyyy-MM-dd HH:mm:ss');
    
    let text = `${title}\n`;
    text += `创建时间: ${date}\n`;
    text += `模型: ${conversation.modelId || conversation.model_id || '未知'}\n`;
    text += `${'='.repeat(50)}\n\n`;
    
    messages.forEach((message, index) => {
      const role = (message).role === 'user' ? '用户' : '助手';
      const timestamp = format(new Date(message.createdAt || (message).created_at), 'HH:mm:ss');
      
      text += `[${timestamp}] ${role}:\n`;
      text += `${message.content}\n\n`;
      
      if (index < messages.length - 1) {
        text += `${'-'.repeat(30)}\n\n`;
      }
    });
    
    return text;
  }
}

// 导出单例实例
export const historyService = HistoryService.getInstance(); 
