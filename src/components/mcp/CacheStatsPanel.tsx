"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trash2, RefreshCw, HardDrive } from 'lucide-react';
import { persistentCache } from '@/lib/mcp/persistentCache';

interface CacheStats {
  totalServers: number;
  cachedServers: string[];
  lastUpdate: number;
  cacheSize: number;
}

export function CacheStatsPanel() {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(false);

  const loadStats = async () => {
    try {
      const cacheStats = await persistentCache.getCacheStats();
      setStats(cacheStats);
    } catch (error) {
      console.error('获取缓存统计失败:', error);
    }
  };

  const handleClearCache = async (serverName?: string) => {
    setLoading(true);
    try {
      await persistentCache.clearCache(serverName);
      await loadStats();
      console.log(serverName ? `已清除 ${serverName} 的缓存` : '已清除所有缓存');
    } catch (error) {
      console.error('清除缓存失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatTime = (timestamp: number) => {
    if (!timestamp) return '从未';
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN');
  };

  useEffect(() => {
    loadStats();
  }, []);

  if (!stats) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="w-5 h-5" />
            MCP缓存管理
          </CardTitle>
          <CardDescription>正在加载缓存信息...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="w-5 h-5" />
          MCP缓存管理
        </CardTitle>
        <CardDescription>
          管理MCP工具信息的本地缓存，提升连接速度
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 统计信息 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">{stats.totalServers}</div>
            <div className="text-sm text-slate-500">缓存服务器</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{formatBytes(stats.cacheSize)}</div>
            <div className="text-sm text-slate-500">缓存大小</div>
          </div>
          <div className="col-span-2 text-center">
            <div className="text-sm text-slate-600">最后更新: {formatTime(stats.lastUpdate)}</div>
          </div>
        </div>

        {/* 服务器列表 */}
        {stats.cachedServers.length > 0 && (
          <div>
            <h4 className="font-medium mb-2">已缓存的服务器</h4>
            <div className="flex flex-wrap gap-2">
              {stats.cachedServers.map((server) => (
                <div key={server} className="flex items-center gap-1">
                  <Badge variant="secondary">{server}</Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleClearCache(server)}
                    disabled={loading}
                    className="h-6 w-6 p-0 hover:bg-red-100"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-2 pt-4 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={loadStats}
            disabled={loading}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          
          {stats.totalServers > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => handleClearCache()}
              disabled={loading}
              className="flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              清除所有缓存
            </Button>
          )}
        </div>

        {/* 帮助信息 */}
        <div className="text-xs text-slate-500 space-y-1">
          <p>• 缓存会在24小时后自动过期</p>
          <p>• 缓存可以在服务器离线时提供工具信息</p>
          <p>• 清除缓存后下次连接会重新获取工具信息</p>
        </div>
      </CardContent>
    </Card>
  );
}

