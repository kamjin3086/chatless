'use client';

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2, Download, Grid, List, BarChart3, RefreshCw, X, Search } from 'lucide-react';
import { SearchInput } from '@/components/ui/search-input';
import { useHistoryStore } from '@/store/historyStore';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "../ui/input";

export default function HistoryToolbar() {
  const {
    selectedItems,
    searchQuery,
    sortBy,
    sortOrder,
    viewMode,
    showStats,
    isLoading,
    setSearchQuery,
    clearSelection,
    batchDelete,
    setSortBy,
    setSortOrder,
    setViewMode,
    toggleStats,
    refresh
  } = useHistoryStore();

  const [localSearchQuery, setLocalSearchQuery] = useState(searchQuery);
  
  // 批量删除确认相关状态
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);

  const handleSearch = () => {
    setSearchQuery(localSearchQuery);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleBatchDelete = async () => {
    if (selectedItems.length === 0) return;
    setBatchDeleteDialogOpen(true);
  };

  // 确认批量删除操作
  const handleConfirmBatchDelete = async () => {
    await batchDelete();
    setBatchDeleteDialogOpen(false);
  };

  // 取消批量删除
  const handleCancelBatchDelete = () => {
    setBatchDeleteDialogOpen(false);
  };

  const handleExportSelected = async () => {
    // TODO: 实现批量导出功能
    console.log('批量导出选中的对话:', selectedItems);
  };

  const handleExportAll = async () => {
    // TODO: 实现全部导出功能
    console.log('导出所有对话');
    // 这里应该调用导出服务来导出所有对话
  };

  const clearSearch = () => {
    setLocalSearchQuery('');
    setSearchQuery('');
  };

  return (
    <>
      <div className="border-b border-gray-100 dark:border-slate-700 bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm px-4 text-gray-700 dark:text-gray-300 glass-surface">
        {/* 主工具栏 - 简化版 */}
        <div className="flex items-center justify-between p-4 gap-4">
          {/* 左侧：搜索 */}
          <div className="flex items-center gap-3 flex-1">
            {/* 搜索框 */}
            
            <div className="relative w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
              <Input 
                type="text" 
                placeholder="搜索对话标题、内容..."
                value={localSearchQuery}
                onChange={(e) => setLocalSearchQuery(e.target.value)}
                onKeyDown={handleKeyPress}
                className="pl-10 pr-3 py-1.5 text-[13px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg w-full focus-visible:ring-2 focus-visible:ring-blue-500/20 focus-visible:ring-offset-0 transition-all duration-200"
              />
               {localSearchQuery && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                  onClick={clearSearch}
                  title="清除搜索"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
            
          </div>

          {/* 右侧：排序和视图控制 */}
          <div className="flex items-center gap-2">
            {/* 全部导出按钮 */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleExportAll}
              title="导出所有对话"
            >
              <Download className="h-4 w-4" />
            </Button>

            {/* 排序控制 */}
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500 whitespace-nowrap">排序:</span>
              <Select value={sortBy} onValueChange={(value) => setSortBy(value as any)}>
                <SelectTrigger className="w-20 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date">时间</SelectItem>
                  <SelectItem value="title">标题</SelectItem>
                  <SelectItem value="model">模型</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                title={sortOrder === 'asc' ? '升序' : '降序'}
              >
                {sortOrder === 'asc' ? '↑' : '↓'}
              </Button>
            </div>

            {/* 视图切换 */}
            <div className="flex border rounded-md">
              <Button
                variant={viewMode === 'list' ? 'soft' : 'ghost'}
                size="sm"
                className="rounded-r-none h-8"
                onClick={() => setViewMode('list')}
                title="列表视图"
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'grid' ? 'soft' : 'ghost'}
                size="sm"
                className="rounded-l-none h-8"
                onClick={() => setViewMode('grid')}
                title="网格视图"
              >
                <Grid className="h-4 w-4" />
              </Button>
            </div>

            {/* 统计切换 */}
            <Button
              variant={showStats ? 'soft' : 'outline'}
              size="sm"
              className="h-8"
              onClick={toggleStats}
              title="显示统计信息"
            >
              <BarChart3 className="h-4 w-4" />
            </Button>

            {/* 刷新 */}
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={refresh}
              disabled={isLoading}
              title="刷新"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* 批量操作栏（保持轻盈, 去除背景色及边框） */}
        {selectedItems.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-800/70 text-gray-600 dark:text-gray-300">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                已选择 {selectedItems.length} 项
              </Badge>
              <Button variant="ghost" size="sm" onClick={clearSelection} className="cursor-pointer">
                取消选择
              </Button>
            </div>
            
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={handleExportSelected} title="导出选中" className="cursor-pointer">
                <Download className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={handleBatchDelete} title="删除选中" className="cursor-pointer">
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 批量删除确认对话框 */}
      <AlertDialog open={batchDeleteDialogOpen} onOpenChange={setBatchDeleteDialogOpen}>
        <AlertDialogContent>
          {/* 右上角关闭按钮 */}
          <button
            onClick={() => setBatchDeleteDialogOpen(false)}
            className="absolute top-4 right-4 p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200 cursor-pointer"
            aria-label="关闭"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          
          <AlertDialogHeader className="pr-8">
            <AlertDialogTitle>确认批量删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除选中的 {selectedItems.length} 个对话吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelBatchDelete}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmBatchDelete}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}