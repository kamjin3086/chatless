"use client";

import { useState, useEffect } from 'react';
import { startupMonitor, type StartupPerformanceReport } from '@/lib/utils/startupPerformanceMonitor';

export function PerformanceMonitor() {
  const [report, setReport] = useState<StartupPerformanceReport | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // 延迟显示性能报告
    const timer = setTimeout(() => {
      const performanceReport = startupMonitor.generateReport();
      setReport(performanceReport);
      setIsVisible(true);
    }, 3500); // 3.5秒后显示

    return () => clearTimeout(timer);
  }, []);

  if (!isVisible || !report || process.env.NODE_ENV !== 'development') {
    return null;
  }

  const format = (time: number | null) => time === null ? '未观测到' : `${time.toFixed(1)} ms`;

  return (
    <div className="fixed bottom-4 right-4 bg-white border border-slate-200 rounded-lg shadow-lg p-4 max-w-md z-50">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-800">🚀 启动性能报告</h3>
        <button
          onClick={() => setIsVisible(false)}
          className="text-slate-400 hover:text-slate-600"
        >
          ✕
        </button>
      </div>

      <div className="space-y-3">
        {/* 总体统计 */}
        <div className="bg-slate-50 p-3 rounded-md">
          <div className="flex justify-between items-center">
            <span className="text-sm text-slate-600">WebView 首次内容绘制:</span>
            <span className="text-sm font-medium">{format(report.firstContentfulPaint)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-slate-600">历史列表可见:</span>
            <span className="text-sm font-medium">{format(report.readiness.historyVisible)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-slate-600">输入框可编辑:</span>
            <span className="text-sm font-medium">{format(report.readiness.composerEditable)}</span>
          </div>
        </div>

        {/* 各阶段耗时 */}
        <div>
          <h4 className="text-xs font-medium text-slate-700 mb-2">前台阶段（不求和）</h4>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {report.phases.slice(0, 8).map((phase, index) => (
              <div key={index} className="flex justify-between items-center text-xs">
                <span className="text-slate-600 truncate">{phase.name}</span>
                <span className="text-slate-800 font-medium">{phase.duration === undefined ? '尚未结束' : format(phase.duration)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex space-x-2 pt-2 border-t border-slate-200">
          <button
            onClick={() => startupMonitor.printReport()}
            className="text-xs bg-blue-500 text-white px-2 py-1 rounded-md hover:bg-blue-600"
          >
            详细报告
          </button>
          <button
            onClick={() => startupMonitor.reset()}
            className="text-xs bg-slate-500 text-white px-2 py-1 rounded-md hover:bg-slate-600"
          >
            重置
          </button>
        </div>
      </div>
    </div>
  );
} 