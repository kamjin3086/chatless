/**
 * 性能监控工具
 * 用于监控和对比事件驱动架构的性能提升
 */

export interface PerformanceMetric {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export interface PerformanceReport {
  totalEvents: number;
  totalDuration: number;
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  metrics: PerformanceMetric[];
}

class PerformanceMonitorClass {
  private metrics: Map<string, PerformanceMetric> = new Map();
  private completedMetrics: PerformanceMetric[] = [];
  private enabled: boolean = true;

  /**
   * 启用/禁用性能监控
   */
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  /**
   * 开始监控一个操作
   */
  start(name: string, metadata?: Record<string, unknown>): void {
    if (!this.enabled) return;

    // 抽样：避免高频事件（如 token/event 处理）撑爆内存或拖慢主线程
    // 仅记录 1% 的高频事件，或针对非高频事件全量记录
    const isHighFreq = name.includes('token') || name.includes('Event') || name.includes('dispatch');
    if (isHighFreq && Math.random() > 0.01) return;

    this.metrics.set(name, {
      name,
      startTime: performance.now(),
      metadata,
    });
  }

  /**
   * 结束监控一个操作
   */
  end(name: string, metadata?: Record<string, unknown>): number | null {
    if (!this.enabled) return null;

    const metric = this.metrics.get(name);
    if (!metric) {
      // 在抽样模式下，大部分事件没有 metric 是正常的，不应打印警告
      // console.warn(`[PerformanceMonitor] Metric "${name}" not found`);
      return null;
    }

    const endTime = performance.now();
    const duration = endTime - metric.startTime;

    const completedMetric: PerformanceMetric = {
      ...metric,
      endTime,
      duration,
      metadata: { ...metric.metadata, ...metadata },
    };

    this.completedMetrics.push(completedMetric);
    this.metrics.delete(name);

    return duration;
  }

  /**
   * 测量一个同步函数的执行时间
   */
  measure<T>(name: string, fn: () => T, metadata?: Record<string, unknown>): T {
    if (!this.enabled) return fn();

    this.start(name, metadata);
    try {
      const result = fn();
      this.end(name);
      return result;
    } catch (error) {
      this.end(name, { error: true });
      throw error;
    }
  }

  /**
   * 测量一个异步函数的执行时间
   */
  async measureAsync<T>(
    name: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    if (!this.enabled) return fn();

    this.start(name, metadata);
    try {
      const result = await fn();
      this.end(name);
      return result;
    } catch (error) {
      this.end(name, { error: true });
      throw error;
    }
  }

  /**
   * 获取指定名称的所有指标
   */
  getMetrics(name?: string): PerformanceMetric[] {
    if (!name) return this.completedMetrics;
    return this.completedMetrics.filter((m) => m.name === name);
  }

  /**
   * 生成性能报告
   */
  getReport(name?: string): PerformanceReport {
    const metrics = this.getMetrics(name);
    const durations = metrics
      .map((m) => m.duration)
      .filter((d): d is number => d !== undefined);

    if (durations.length === 0) {
      return {
        totalEvents: 0,
        totalDuration: 0,
        averageDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        metrics: [],
      };
    }

    return {
      totalEvents: metrics.length,
      totalDuration: durations.reduce((a, b) => a + b, 0),
      averageDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      metrics,
    };
  }

  /**
   * 对比两个性能报告
   */
  compare(
    baseline: PerformanceReport,
    current: PerformanceReport
  ): {
    improvement: number; // 百分比，正数表示提升
    baselineAvg: number;
    currentAvg: number;
    description: string;
  } {
    const baselineAvg = baseline.averageDuration;
    const currentAvg = current.averageDuration;

    if (baselineAvg === 0) {
      return {
        improvement: 0,
        baselineAvg: 0,
        currentAvg,
        description: '无基线数据',
      };
    }

    const improvement = ((baselineAvg - currentAvg) / baselineAvg) * 100;

    return {
      improvement,
      baselineAvg,
      currentAvg,
      description:
        improvement > 0
          ? `性能提升 ${improvement.toFixed(1)}%`
          : `性能下降 ${Math.abs(improvement).toFixed(1)}%`,
    };
  }

  /**
   * 清空所有指标
   */
  clear(): void {
    this.metrics.clear();
    this.completedMetrics = [];
  }

  /**
   * 导出为JSON
   */
  export(): string {
    return JSON.stringify(
      {
        completedMetrics: this.completedMetrics,
        timestamp: Date.now(),
      },
      null,
      2
    );
  }

  /**
   * 打印报告到控制台
   */
  printReport(name?: string): void {
    const report = this.getReport(name);
    console.group(`[性能报告] ${name || '全部'}`);
    console.table({
      '总事件数': report.totalEvents,
      '总耗时(ms)': report.totalDuration.toFixed(2),
      '平均耗时(ms)': report.averageDuration.toFixed(2),
      '最小耗时(ms)': report.minDuration.toFixed(2),
      '最大耗时(ms)': report.maxDuration.toFixed(2),
    });
    console.groupEnd();
  }
}

// 单例导出
export const performanceMonitor = new PerformanceMonitorClass();

// 开发环境默认启用
if (typeof window !== 'undefined') {
  (window as any).__performanceMonitor = performanceMonitor;
}

