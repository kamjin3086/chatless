'use client';

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useHistoryStore } from '@/store/historyStore';
import { useEffect } from 'react';
import { MessageSquare, Star, Bot, TrendingUp, Calendar } from 'lucide-react';

export default function HistoryStats() {
  const { stats, showStats, loadStats } = useHistoryStore();

  useEffect(() => {
    console.log('[HistoryStats] showStats:', showStats, 'stats:', stats);
    if (showStats && !stats) {
      console.log('[HistoryStats] 开始加载统计数据...');
      loadStats();
    }
  }, [showStats, stats, loadStats]);

  // 添加调试日志
  console.log('[HistoryStats] 渲染状态:', { showStats, stats: !!stats });

  if (!showStats) {
    console.log('[HistoryStats] 统计信息被隐藏');
    return null;
  }

  if (!stats) {
    console.log('[HistoryStats] 统计数据为空，显示加载状态');
    return (
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-100/60 dark:bg-gray-900/60">
        <div className="flex items-center justify-center">
          <div className="text-sm text-gray-600">正在加载统计信息...</div>
        </div>
      </div>
    );
  }

  console.log('[HistoryStats] 渲染统计数据:', stats);

  const topModels = Object.entries(stats.modelUsage)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  const topTags = Object.entries(stats.tagsUsage)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);

  return (
    <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-100/60 dark:bg-gray-900/60">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        {/* 总对话数 */}
        <Card className="glass-panel bg-white/40 dark:bg-slate-900/40 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-300">总对话数</CardTitle>
            <MessageSquare className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.totalConversations}</div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              共 {stats.totalMessages} 条消息
            </p>
          </CardContent>
        </Card>

        {/* 收藏数 */}
        <Card className="glass-panel bg-white/40 dark:bg-slate-900/40 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-300">收藏对话</CardTitle>
            <Star className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.favoriteCount}</div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              占比 {stats.totalConversations > 0 ? Math.round((stats.favoriteCount / stats.totalConversations) * 100) : 0}%
            </p>
          </CardContent>
        </Card>

        {/* 平均消息数 */}
        <Card className="glass-panel bg-white/40 dark:bg-slate-900/40 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-300">平均消息数</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {stats.totalConversations > 0 ? Math.round(stats.totalMessages / stats.totalConversations) : 0}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              每个对话平均
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 模型使用统计 */}
        <Card className="glass-panel bg-white/40 dark:bg-slate-900/40 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-300 flex items-center gap-2">
              <Bot className="h-4 w-4" />
              模型使用统计
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topModels.length > 0 ? (
              <div className="space-y-2">
                {topModels.map(([model, count]) => (
                  <div key={model} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs border-gray-300 dark:border-slate-600/60 text-gray-700 dark:text-gray-200">
                        {model}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{count}</div>
                      <div className="w-16 bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-slate-600 dark:bg-slate-400 h-2 rounded-full" 
                          style={{ 
                            width: `${(count / stats.totalConversations) * 100}%` 
                          }}
                        ></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">暂无数据</p>
            )}
          </CardContent>
        </Card>

        {/* 标签使用统计 */}
        <Card className="glass-panel bg-white/40 dark:bg-slate-900/40 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-300 flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              热门标签
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topTags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {topTags.map(([tag, count]) => (
                  <Badge 
                    key={tag} 
                    variant="secondary" 
                    className="text-xs flex items-center gap-1"
                  >
                    {tag}
                    <span className="bg-gray-300 text-gray-700 rounded-full px-1 text-xs">
                      {count}
                    </span>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">暂无标签数据</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
} 
