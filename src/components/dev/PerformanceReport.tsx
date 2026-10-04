"use client";

import { useState, useEffect } from 'react';
import { performanceMonitor } from '@/lib/performance/PerformanceMonitor';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function PerformanceReport() {
  const [report, setReport] = useState<any>(null);
  const [comparison, setComparison] = useState<any>(null);

  const refreshReport = () => {
    const eventDrivenReport = performanceMonitor.getReport('onEvent');
    const legacyTokenReport = performanceMonitor.getReport('onToken');
    
    setReport({
      eventDriven: eventDrivenReport,
      legacyToken: legacyTokenReport,
    });

    if (eventDrivenReport.totalEvents > 0 && legacyTokenReport.totalEvents > 0) {
      const comp = performanceMonitor.compare(legacyTokenReport, eventDrivenReport);
      setComparison(comp);
    }
  };

  const clearMetrics = () => {
    performanceMonitor.clear();
    setReport(null);
    setComparison(null);
  };

  const exportData = () => {
    const data = performanceMonitor.export();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `performance-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    const interval = setInterval(refreshReport, 2000);
    return () => clearInterval(interval);
  }, []);

  if (!report) {
    return (
      <Card className="p-4">
        <div className="text-sm text-muted-foreground">
          正在收集性能数据...
        </div>
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={refreshReport}>刷新</Button>
          <Button size="sm" variant="outline" onClick={clearMetrics}>清空</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">性能监控报告</h3>
        <div className="flex gap-2">
          <Button size="sm" onClick={refreshReport}>刷新</Button>
          <Button size="sm" variant="outline" onClick={clearMetrics}>清空</Button>
          <Button size="sm" variant="outline" onClick={exportData}>导出</Button>
        </div>
      </div>

      {/* 性能对比 */}
      {comparison && (
        <div className="p-3 bg-primary/5 rounded-lg">
          <div className="font-medium text-lg mb-2">
            {comparison.description}
          </div>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">传统模式</div>
              <div className="font-mono">{comparison.baselineAvg.toFixed(3)}ms</div>
            </div>
            <div>
              <div className="text-muted-foreground">事件驱动</div>
              <div className="font-mono">{comparison.currentAvg.toFixed(3)}ms</div>
            </div>
            <div>
              <div className="text-muted-foreground">提升</div>
              <div className={`font-mono font-semibold ${comparison.improvement > 0 ? 'text-green-600' : 'text-red-600'}`}>
                {comparison.improvement > 0 ? '+' : ''}{comparison.improvement.toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 事件驱动模式 */}
      <div className="space-y-2">
        <h4 className="font-medium text-sm">事件驱动模式 (onEvent)</h4>
        <div className="grid grid-cols-4 gap-3 text-sm">
          <div className="p-2 bg-muted rounded-md">
            <div className="text-muted-foreground text-xs">事件数</div>
            <div className="font-mono font-semibold">{report.eventDriven.totalEvents}</div>
          </div>
          <div className="p-2 bg-muted rounded-md">
            <div className="text-muted-foreground text-xs">平均耗时</div>
            <div className="font-mono font-semibold">{report.eventDriven.averageDuration.toFixed(3)}ms</div>
          </div>
          <div className="p-2 bg-muted rounded-md">
            <div className="text-muted-foreground text-xs">最小</div>
            <div className="font-mono">{report.eventDriven.minDuration.toFixed(3)}ms</div>
          </div>
          <div className="p-2 bg-muted rounded-md">
            <div className="text-muted-foreground text-xs">最大</div>
            <div className="font-mono">{report.eventDriven.maxDuration.toFixed(3)}ms</div>
          </div>
        </div>
      </div>

      {/* 传统模式 */}
      <div className="space-y-2">
        <h4 className="font-medium text-sm">传统模式 (onToken)</h4>
        <div className="grid grid-cols-4 gap-3 text-sm">
          <div className="p-2 bg-muted rounded-md">
            <div className="text-muted-foreground text-xs">Token数</div>
            <div className="font-mono font-semibold">{report.legacyToken.totalEvents}</div>
          </div>
          <div className="p-2 bg-muted rounded-md">
            <div className="text-muted-foreground text-xs">平均耗时</div>
            <div className="font-mono font-semibold">{report.legacyToken.averageDuration.toFixed(3)}ms</div>
          </div>
          <div className="p-2 bg-muted rounded-md">
            <div className="text-muted-foreground text-xs">最小</div>
            <div className="font-mono">{report.legacyToken.minDuration.toFixed(3)}ms</div>
          </div>
          <div className="p-2 bg-muted rounded-md">
            <div className="text-muted-foreground text-xs">最大</div>
            <div className="font-mono">{report.legacyToken.maxDuration.toFixed(3)}ms</div>
          </div>
        </div>
      </div>

      {/* 详细指标 */}
      <details className="text-sm">
        <summary className="cursor-pointer font-medium mb-2">详细指标</summary>
        <div className="max-h-60 overflow-y-auto space-y-1">
          {[...report.eventDriven.metrics, ...report.legacyToken.metrics]
            .sort((a, b) => b.startTime - a.startTime)
            .slice(0, 50)
            .map((metric: any, idx: number) => (
              <div key={idx} className="text-xs font-mono p-1 bg-muted/50 rounded-md flex justify-between">
                <span className="truncate">{metric.name}</span>
                <span>{metric.duration?.toFixed(3)}ms</span>
              </div>
            ))}
        </div>
      </details>
    </Card>
  );
}

