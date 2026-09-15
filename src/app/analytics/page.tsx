'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageTabs } from '@/components/ui/PageTabs';
import { History, BarChart3 } from 'lucide-react';

// 历史记录组件
import HistoryStats from '@/components/history/HistoryStats';
import HistoryToolbar from '@/components/history/HistoryToolbar';
import HistoryQuickFilter from '@/components/history/HistoryQuickFilter';
import HistoryList from '@/components/history/HistoryList';
import { useHistoryStore } from '@/store/historyStore';

// 统计组件
import { AnalyticsToolbar } from "@/components/analytics/AnalyticsToolbar";
import { MessageSquare, Bot, Tags, TrendingUp, Star, Flag } from "lucide-react";
import { historyService } from "@/lib/historyService";
import { HistoryStats as HistoryStatsType } from "@/types/history";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const tabs = [
  { id: 'history', label: '历史', icon: <History className="w-4 h-4" /> },
  { id: 'analytics', label: '统计', icon: <BarChart3 className="w-4 h-4" /> },
];

export default function AnalyticsPage() {
  const searchParams = useSearchParams();
  
  // Tab 状态
  const [activeTab, setActiveTab] = useState<string>(() => {
    const tabParam = searchParams.get('tab');
    return tabParam === 'history' || tabParam === 'analytics' ? tabParam : 'history';
  });

  // URL 参数同步
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'history' || tabParam === 'analytics') {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  return (
    <div className="flex flex-col h-full bg-white/95 dark:bg-slate-900/95 overflow-hidden glass-surface">
      {/* 顶部 Tab */}
      <PageTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* 内容区域 */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'history' ? (
          <HistoryContent />
        ) : (
          <AnalyticsContent />
        )}
      </div>
    </div>
  );
}

// 历史记录内容
function HistoryContent() {
  const { showStats } = useHistoryStore();

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 glass-surface">
      {/* 统计信息抽屉 */}
      <div className={`transition-all duration-300 ease-in-out overflow-hidden ${
        showStats ? 'max-h-screen opacity-100' : 'max-h-0 opacity-0'
      }`}>
        <HistoryStats />
      </div>
      
      {/* 工具栏 */}
      <HistoryToolbar />
      
      {/* 快速筛选栏 */}
      <HistoryQuickFilter />
      
      {/* 对话列表 */}
      <div className="flex-1 min-h-0">
        <HistoryList />
      </div>
    </div>
  );
}

// 统计内容
function AnalyticsContent() {
  const [stats, setStats] = useState<HistoryStatsType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [range, setRange] = useState<string>('30');

  useEffect(() => {
    const loadStats = async () => {
      try {
        setIsLoading(true);
        const historyStats = await historyService.getHistoryStats();
        setStats(historyStats);
      } catch (error) {
        console.error('加载统计数据失败:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadStats();
  }, []);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500">
        加载统计数据中...
      </div>
    );
  }

  const topModels = stats ? Object.entries(stats.modelUsage)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5) : [];

  const topTags = stats ? Object.entries(stats.tagsUsage)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8) : [];

  return (
    <div className="flex flex-col h-full">
      <AnalyticsToolbar 
        range={range}
        onRangeChange={setRange}
        onExport={() => {}}
        onRefresh={() => window.location.reload()}
      />
      
      <div className="flex-1 p-4 overflow-y-auto bg-slate-50 dark:bg-slate-900/50">
        {/* 概览统计卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card className="glass-panel bg-white/40 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/40">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium text-slate-500">总对话数</CardTitle>
              <MessageSquare className="h-4 w-4 text-slate-500" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-semibold text-slate-800 dark:text-slate-100">{stats?.totalConversations || 0}</div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                共 {stats?.totalMessages || 0} 条消息
              </p>
            </CardContent>
          </Card>

          <Card className="glass-panel bg-white/40 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/40">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium text-slate-500">收藏对话</CardTitle>
              <Star className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-semibold text-slate-800 dark:text-slate-100">{stats?.favoriteCount || 0}</div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                占比 {stats && stats.totalConversations > 0 ? Math.round((stats.favoriteCount / stats.totalConversations) * 100) : 0}%
              </p>
            </CardContent>
          </Card>

          <Card className="glass-panel bg-white/40 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/40">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium text-slate-500">重要对话</CardTitle>
              <Flag className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-semibold text-slate-800 dark:text-slate-100">{stats?.importantCount || 0}</div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                占比 {stats && stats.totalConversations > 0 ? Math.round((stats.importantCount / stats.totalConversations) * 100) : 0}%
              </p>
            </CardContent>
          </Card>

          <Card className="glass-panel bg-white/40 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/40">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium text-slate-500">平均消息数</CardTitle>
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-semibold text-slate-800 dark:text-slate-100">
                {stats && stats.totalConversations > 0 ? Math.round(stats.totalMessages / stats.totalConversations) : 0}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">每个对话平均</p>
            </CardContent>
          </Card>
        </div>

        {/* 详细统计图表 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 模型使用统计 */}
          <Card className="glass-panel bg-white/40 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-medium text-slate-500 flex items-center gap-2">
                <Bot className="h-4 w-4" />
                模型使用统计
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topModels.length > 0 ? (
                <div className="space-y-2.5">
                  {topModels.map(([model, count]) => (
                    <div key={model} className="flex items-center justify-between">
                      <Badge variant="outline" className="text-[11px] border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300">
                        {model}
                      </Badge>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{count}</span>
                        <div className="w-16 bg-slate-200 dark:bg-slate-700 rounded-full h-1.5">
                          <div 
                            className="bg-slate-600 dark:bg-slate-400 h-1.5 rounded-full" 
                            style={{ width: `${stats ? (count / stats.totalConversations) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">暂无数据</p>
              )}
            </CardContent>
          </Card>

          {/* 标签使用统计 */}
          <Card className="glass-panel bg-white/40 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-medium text-slate-500 flex items-center gap-2">
                <Tags className="h-4 w-4" />
                热门标签
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topTags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {topTags.map(([tag, count]) => (
                    <Badge 
                      key={tag} 
                      variant="secondary" 
                      className="text-[11px] flex items-center gap-1 bg-slate-100 dark:bg-slate-700"
                    >
                      {tag}
                      <span className="bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 rounded-full px-1 text-[10px]">
                        {count}
                      </span>
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">暂无标签数据</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
