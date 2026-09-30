import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { HistoryItem, HistoryFilter, HistoryGroup, HistoryStats } from '@/types/history';
import { historyService } from '@/lib/historyService';

interface HistoryState {
  // 数据状态
  historyItems: HistoryItem[];
  groupedHistory: HistoryGroup[];
  stats: HistoryStats | null;
  
  // UI状态
  isLoading: boolean;
  selectedItems: string[];
  currentFilter: HistoryFilter;
  searchQuery: string;
  sortBy: 'date' | 'title' | 'model';
  sortOrder: 'asc' | 'desc';
  
  // 视图状态
  viewMode: 'list' | 'grid';
  showStats: boolean;
  
  // 操作方法
  loadHistory: () => Promise<void>;
  loadGroupedHistory: () => Promise<void>;
  loadStats: () => Promise<void>;
  
  // 筛选和搜索
  setFilter: (filter: Partial<HistoryFilter>) => void;
  setSearchQuery: (query: string) => void;
  clearFilters: () => void;
  
  // 选择操作
  selectItem: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  toggleSelection: (id: string) => void;
  
  // 排序
  setSortBy: (sortBy: 'date' | 'title' | 'model') => void;
  setSortOrder: (order: 'asc' | 'desc') => void;
  applySorting: () => void;
  
  // 视图控制
  setViewMode: (mode: 'list' | 'grid') => void;
  toggleStats: () => void;
  
  // 数据操作
  toggleFavorite: (id: string) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  batchDelete: () => Promise<void>;
  exportItem: (id: string, format: 'json' | 'markdown' | 'txt') => Promise<string | null>;
  
  // 刷新数据
  refresh: () => Promise<void>;
}

export const useHistoryStore = create<HistoryState>()(
  immer((set, get) => ({
    // 初始状态
    historyItems: [],
    groupedHistory: [],
    stats: null,
    isLoading: false,
    selectedItems: [],
    currentFilter: { dateRange: 'all' },
    searchQuery: '',
    sortBy: 'date',
    sortOrder: 'desc',
    viewMode: 'list',
    showStats: false,

    // 加载历史记录
    loadHistory: async () => {
      set(state => {
        state.isLoading = true;
      });

      try {
        const items = await historyService.getFilteredHistory(get().currentFilter);
        
        set(state => {
          state.historyItems = items;
          state.isLoading = false;
        });
      } catch (error) {
        console.error('加载历史记录失败:', error);
        set(state => {
          state.isLoading = false;
        });
      }
    },

    // 加载分组历史记录
    loadGroupedHistory: async () => {
      set(state => {
        state.isLoading = true;
      });

      try {
        const groups = await historyService.getGroupedHistory(get().currentFilter);
        
        set(state => {
          state.groupedHistory = groups;
          state.isLoading = false;
        });
      } catch (error) {
        console.error('加载分组历史记录失败:', error);
        set(state => {
          state.isLoading = false;
        });
      }
    },

    // 加载统计信息
    loadStats: async () => {
      console.log('[HistoryStore] loadStats called');
      try {
        const stats = await historyService.getHistoryStats();
        console.log('[HistoryStore] loadStats result:', stats);
        
        set(state => {
          state.stats = stats;
        });
        
        console.log('[HistoryStore] Stats set in state:', get().stats);
      } catch (error) {
        console.error('[HistoryStore] 加载统计信息失败:', error);
      }
    },

    // 设置筛选条件
    setFilter: (filter) => {
      set(state => {
        state.currentFilter = { ...state.currentFilter, ...filter };
      });
      
      // 重新加载数据
      get().loadGroupedHistory();
    },

    // 设置搜索查询
    setSearchQuery: (query) => {
      set(state => {
        state.searchQuery = query;
        state.currentFilter.searchQuery = query || undefined;
      });
      
      // 重新加载数据
      get().loadGroupedHistory();
    },

    // 清除筛选条件
    clearFilters: () => {
      set(state => {
        state.currentFilter = { dateRange: 'all' };
        state.searchQuery = '';
      });
      
      get().loadGroupedHistory();
    },

    // 选择项目
    selectItem: (id) => {
      set(state => {
        if (!state.selectedItems.includes(id)) {
          state.selectedItems.push(id);
        }
      });
    },

    // 全选
    selectAll: () => {
      set(state => {
        const allIds = state.historyItems.map(item => item.id);
        state.selectedItems = allIds;
      });
    },

    // 清除选择
    clearSelection: () => {
      set(state => {
        state.selectedItems = [];
      });
    },

    // 切换选择
    toggleSelection: (id) => {
      set(state => {
        const index = state.selectedItems.indexOf(id);
        if (index > -1) {
          state.selectedItems.splice(index, 1);
        } else {
          state.selectedItems.push(id);
        }
      });
    },

    // 设置排序字段
    setSortBy: (sortBy) => {
      set(state => {
        state.sortBy = sortBy;
      });
      
      get().applySorting();
    },

    // 设置排序顺序
    setSortOrder: (order) => {
      set(state => {
        state.sortOrder = order;
      });
      
      get().applySorting();
    },

    // 应用排序
    applySorting: () => {
      set(state => {
        const { sortBy, sortOrder } = state;
        
        state.historyItems.sort((a, b) => {
          let comparison = 0;
          
          switch (sortBy) {
            case 'date':
              comparison = a.timestamp - b.timestamp;
              break;
            case 'title':
              comparison = a.title.localeCompare(b.title);
              break;
            case 'model':
              comparison = a.model.localeCompare(b.model);
              break;
          }
          
          return sortOrder === 'asc' ? comparison : -comparison;
        });
        
        // 同时对分组历史进行排序
        state.groupedHistory.forEach(group => {
          group.items.sort((a, b) => {
            let comparison = 0;
            
            switch (sortBy) {
              case 'date':
                comparison = a.timestamp - b.timestamp;
                break;
              case 'title':
                comparison = a.title.localeCompare(b.title);
                break;
              case 'model':
                comparison = a.model.localeCompare(b.model);
                break;
            }
            
            return sortOrder === 'asc' ? comparison : -comparison;
          });
        });
      });
    },

    // 设置视图模式
    setViewMode: (mode) => {
      set(state => {
        state.viewMode = mode;
      });
    },

    // 切换统计显示
    toggleStats: () => {
      console.log('[HistoryStore] toggleStats called, current showStats:', get().showStats);
      set(state => {
        state.showStats = !state.showStats;
      });
      
      const newShowStats = get().showStats;
      console.log('[HistoryStore] toggleStats after update, showStats:', newShowStats);
      
      if (newShowStats && !get().stats) {
        console.log('[HistoryStore] Loading stats because showStats is true and stats is null');
        get().loadStats();
      }
    },

    // 切换收藏
    toggleFavorite: async (id) => {
      try {
        const success = await historyService.toggleFavorite(id);
        
        if (success) {
          set(state => {
            const item = state.historyItems.find(item => item.id === id);
            if (item) {
              item.isFavorite = !item.isFavorite;
            }
            
            // 同时更新分组历史中的项目
            state.groupedHistory.forEach(group => {
              const groupItem = group.items.find(item => item.id === id);
              if (groupItem) {
                groupItem.isFavorite = !groupItem.isFavorite;
              }
            });
          });
        }
      } catch (error) {
        console.error('切换收藏失败:', error);
      }
    },

    // 删除项目
    deleteItem: async (id) => {
      try {
        const success = await historyService.deleteConversation(id);
        
        if (success) {
          set(state => {
            state.historyItems = state.historyItems.filter(item => item.id !== id);
            state.selectedItems = state.selectedItems.filter(item => item !== id);
            
            // 同时从分组历史中删除
            state.groupedHistory.forEach(group => {
              group.items = group.items.filter(item => item.id !== id);
            });
            
            // 移除空的分组
            state.groupedHistory = state.groupedHistory.filter(group => group.items.length > 0);
          });
        }
      } catch (error) {
        console.error('删除项目失败:', error);
      }
    },

    // 批量删除
    batchDelete: async () => {
      const selectedIds = get().selectedItems;
      
      if (selectedIds.length === 0) return;
      
      try {
        const success = await historyService.batchDeleteConversations(selectedIds);
        
        if (success) {
          set(state => {
            state.historyItems = state.historyItems.filter(
              item => !selectedIds.includes(item.id)
            );
            state.selectedItems = state.selectedItems.filter(
              item => !selectedIds.includes(item)
            );
            
            // 同时从分组历史中删除
            state.groupedHistory.forEach(group => {
              group.items = group.items.filter(
                item => !selectedIds.includes(item.id)
              );
            });
            
            // 移除空的分组
            state.groupedHistory = state.groupedHistory.filter(
              group => group.items.length > 0
            );
          });
        }
      } catch (error) {
        console.error('批量删除失败:', error);
      }
    },

    // 导出项目
    exportItem: async (id, format) => {
      try {
        return await historyService.exportConversation(id, format);
      } catch (error) {
        console.error('导出失败:', error);
        return null;
      }
    },

    // 刷新数据
    refresh: async () => {
      await Promise.all([
        get().loadGroupedHistory(),
        get().loadStats()
      ]);
    }
  }))
); 
