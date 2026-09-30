export interface HistoryItem {
  id: string;
  conversationId: string;
  title: string;
  summary: string;
  model: string;
  tags: string[];
  timestamp: number;
  fullTimestamp: string;
  isFavorite: boolean;
  messageCount: number;
  lastMessage: string;
  createdAt: number;
  updatedAt: number;
}

export interface HistoryFilter {
  dateRange: 'today' | 'yesterday' | 'week' | 'month' | 'all';
  model?: string;
  tags?: string[];
  isFavorite?: boolean;
  searchQuery?: string;
}

export interface HistoryGroup {
  date: string;
  displayName: string;
  items: HistoryItem[];
}

export interface HistoryStats {
  totalConversations: number;
  totalMessages: number;
  favoriteCount: number;
  modelUsage: Record<string, number>;
  tagsUsage: Record<string, number>;
} 
