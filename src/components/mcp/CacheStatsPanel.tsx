"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trash2, RefreshCw, HardDrive } from 'lucide-react';
import { persistentCache } from '@/lib/mcp/persistentCache';
import { useTranslation } from '@/i18n/useTranslation';
import { useLocaleStore } from '@/store/localeStore';
import { getHtmlLang } from '@/i18n';

interface CacheStats {
  totalServers: number;
  cachedServers: string[];
  lastUpdate: number;
  cacheSize: number;
}

export function CacheStatsPanel() {
  const t = useTranslation();
  const locale = useLocaleStore((state) => state.locale);
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
    if (!timestamp) return t('mcpCache.never');
    return new Date(timestamp).toLocaleString(getHtmlLang(locale));
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
            {t('mcpCache.title')}
          </CardTitle>
          <CardDescription>{t('mcpCache.loading')}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="w-5 h-5" />
          {t('mcpCache.title')}
        </CardTitle>
        <CardDescription>
          {t('mcpCache.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 统计信息 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">{stats.totalServers}</div>
            <div className="text-sm text-slate-500">{t('mcpCache.cachedServers')}</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{formatBytes(stats.cacheSize)}</div>
            <div className="text-sm text-slate-500">{t('mcpCache.cacheSize')}</div>
          </div>
          <div className="col-span-2 text-center">
            <div className="text-sm text-slate-600">{t('mcpCache.lastUpdated').replace('{0}', formatTime(stats.lastUpdate))}</div>
          </div>
        </div>

        {/* 服务器列表 */}
        {stats.cachedServers.length > 0 && (
          <div>
            <h4 className="font-medium mb-2">{t('mcpCache.serverList')}</h4>
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
            {t('mcpCache.refresh')}
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
              {t('mcpCache.clearAll')}
            </Button>
          )}
        </div>

        {/* 帮助信息 */}
        <div className="text-xs text-slate-500 space-y-1">
          <p>• {t('mcpCache.helpExpire')}</p>
          <p>• {t('mcpCache.helpOffline')}</p>
          <p>• {t('mcpCache.helpRefresh')}</p>
        </div>
      </CardContent>
    </Card>
  );
}

