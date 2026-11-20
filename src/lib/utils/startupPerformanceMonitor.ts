/**
 * 启动性能监测工具
 * 用于跟踪应用启动过程中各个阶段的耗时
 */

import { getVersionInfo } from '@/config/app-info';

export type ChatReadinessMilestone = 'historyVisible' | 'composerEditable';

const readinessLabels: Record<ChatReadinessMilestone, string> = {
  historyVisible: '历史列表可见',
  composerEditable: '输入框可编辑',
};

/** Observe the change after the browser has had a frame to present it. */
export function afterStartupPaint(callback: () => void): () => void {
  let secondFrame: number | undefined;
  const firstFrame = requestAnimationFrame(() => {
    secondFrame = requestAnimationFrame(callback);
  });
  return () => {
    cancelAnimationFrame(firstFrame);
    if (secondFrame !== undefined) cancelAnimationFrame(secondFrame);
  };
}

export interface PerformanceMetric {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  children?: PerformanceMetric[];
  metadata?: Record<string, any>;
}

export interface StartupPerformanceReport {
  firstContentfulPaint: number | null;
  readiness: Record<ChatReadinessMilestone, number | null>;
  phases: PerformanceMetric[];
  backgroundPhases: PerformanceMetric[];
  timestamp: number;
}

class StartupPerformanceMonitor {
  private metrics: Map<string, PerformanceMetric> = new Map();
  private readiness: StartupPerformanceReport['readiness'] = { historyVisible: null, composerEditable: null };
  private currentPhase: string | null = null;
  private phaseStack: string[] = [];
  // 在生产环境也启用监控；仅在开发环境输出控制台日志
  private isEnabled = true;

  private shouldLog(): boolean {
    return process.env.NODE_ENV === 'development';
  }

  /**
   * 开始监测一个阶段
   */
  startPhase(name: string, metadata?: Record<string, any>): void {
    if (!this.isEnabled) return;

    const startTime = performance.now();
    const metric: PerformanceMetric = {
      name,
      startTime,
      children: [],
      metadata
    };

    this.metrics.set(name, metric);
    this.currentPhase = name;
    this.phaseStack.push(name);

    if (this.shouldLog()) {
      console.log(`🚀 [PERF] 开始阶段: ${name}`);
    }
  }

  /**
   * 结束当前阶段
   */
  endPhase(name?: string): void {
    if (!this.isEnabled) return;

    const phaseName = name || this.currentPhase;
    if (!phaseName) return;

    const metric = this.metrics.get(phaseName);
    if (!metric) return;

    metric.endTime = performance.now();
    metric.duration = metric.endTime - metric.startTime;

    // 从栈中移除
    const index = this.phaseStack.indexOf(phaseName);
    if (index > -1) {
      this.phaseStack.splice(index, 1);
    }

    // 更新当前阶段
    this.currentPhase = this.phaseStack[this.phaseStack.length - 1] || null;

    if (this.shouldLog()) {
      console.log(`✅ [PERF] 完成阶段: ${phaseName} (${metric.duration.toFixed(2)}ms)`);
    }
  }

  /**
   * 添加子阶段
   */
  addSubPhase(parentName: string, subPhaseName: string, duration: number, metadata?: Record<string, any>): void {
    if (!this.isEnabled) return;

    const parent = this.metrics.get(parentName);
    if (!parent) return;

    const subPhase: PerformanceMetric = {
      name: subPhaseName,
      startTime: parent.startTime,
      endTime: parent.startTime + duration,
      duration,
      metadata
    };

    parent.children = parent.children || [];
    parent.children.push(subPhase);

    if (this.shouldLog()) {
      console.log(`📊 [PERF] 子阶段: ${parentName} > ${subPhaseName} (${duration.toFixed(2)}ms)`);
    }
  }

  /**
   * 标记关键时间点
   */
  mark(name: string, metadata?: Record<string, any>): void {
    if (!this.isEnabled) return;

    const time = performance.now();
    if (this.shouldLog()) {
      console.log(`📍 [PERF] 标记: ${name} (${time.toFixed(2)}ms)`, metadata);
    }
  }

  markChatReady(milestone: ChatReadinessMilestone): void {
    if (!this.isEnabled || this.readiness[milestone] !== null) return;
    const elapsed = performance.now();
    this.readiness[milestone] = elapsed;
    this.mark(readinessLabels[milestone]);
  }

  /**
   * 生成性能报告
   */
  generateReport(): StartupPerformanceReport {
    const phases = [...this.metrics.values()].sort((a, b) => a.startTime - b.startTime);
    return {
      firstContentfulPaint: performance.getEntriesByName('first-contentful-paint', 'paint')[0]?.startTime ?? null,
      readiness: { ...this.readiness },
      phases: phases.filter((phase) => !phase.metadata?.background),
      backgroundPhases: phases.filter((phase) => phase.metadata?.background),
      timestamp: Date.now(),
    };
  }

  private formatTimings(report: StartupPerformanceReport): string {
    const ms = (value: number) => `${value.toFixed(2)} ms`;
    const firstPaint = report.firstContentfulPaint;
    const lines = [
      '首屏就绪（WebView 计时，不含原生窗口创建）',
      `WebView 首次内容绘制: ${firstPaint === null ? '未测得' : ms(firstPaint)}`,
    ];
    for (const milestone of ['historyVisible', 'composerEditable'] as const) {
      const time = report.readiness[milestone];
      const sincePaint = time !== null && firstPaint !== null && time >= firstPaint ? ms(time - firstPaint) : '未测得';
      lines.push(`${readinessLabels[milestone]}: ${time === null ? '未观测到' : `${ms(time)}（距首次内容绘制 ${sincePaint}）`}`);
    }
    lines.push('以上记录此 WebView 中首次观测到的状态；若稍后才进入聊天页，时间包含导航等待。');
    const sections = [
      ['前台初始化阶段（可能嵌套，不求和）', report.phases],
      ['后台或辅助阶段（不计入首屏就绪）', report.backgroundPhases],
    ] as const;
    for (const [label, phases] of sections) {
      lines.push('', label);
      for (const phase of phases) {
        lines.push(`- ${phase.name}: ${phase.duration === undefined ? '尚未结束' : ms(phase.duration)}（起于 ${ms(phase.startTime)}）`);
        for (const child of phase.children ?? []) {
          if (child.duration !== undefined) lines.push(`  - ${child.name}: ${ms(child.duration)}`);
        }
      }
      if (!phases.length) lines.push('- 无记录');
    }
    return lines.join('\n');
  }

  /**
   * 打印性能报告
   */
  printReport(): void {
    if (!this.isEnabled) return;

    const report = this.generateReport();
    
    if (!this.shouldLog()) return;

    console.log(this.formatTimings(report));
  }

  /**
   * 导出性能报告为文本格式
   */
  exportReport(): string {
    const report = this.generateReport();
    
    let output = '';
    output += '='.repeat(60) + '\n';
    output += '🚀 应用启动性能报告\n';
    output += '='.repeat(60) + '\n';
    output += `生成时间: ${new Date(report.timestamp).toLocaleString()}\n`;
    output += `\n${this.formatTimings(report)}\n\n`;
    
    output += '📋 系统信息:\n';
    output += '-'.repeat(30) + '\n';
    output += `用户代理: ${navigator.userAgent}\n`;
    output += `平台: ${navigator.platform}\n`;
    output += `语言: ${navigator.language}\n`;
    output += `在线状态: ${navigator.onLine ? '在线' : '离线'}\n`;
    output += `内存信息: ${(performance as any).memory ? 
      `已用: ${Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024)}MB, 总计: ${Math.round((performance as any).memory.totalJSHeapSize / 1024 / 1024)}MB` : 
      '不可用'}\n`;
    
    // 添加更多系统信息
    output += '\n🖥️ 硬件信息:\n';
    output += '-'.repeat(30) + '\n';
    output += `CPU核心数: ${navigator.hardwareConcurrency || '未知'}\n`;
    
    // 改进内存检测
    let memoryInfo = '未知';
    if ((navigator as any).deviceMemory) {
      memoryInfo = `${(navigator as any).deviceMemory}GB`;
    } else if ((performance as any).memory) {
      const mem = (performance as any).memory;
      const totalGB = Math.round(mem.jsHeapSizeLimit / 1024 / 1024 / 1024);
      memoryInfo = `${totalGB}GB (JS堆限制)`;
    }
    output += `设备内存: ${memoryInfo}\n`;
    output += `注意: 内存信息可能不准确，受浏览器API限制\n`;
    
    // 尝试获取CPU型号（通过User Agent解析）
    let cpuInfo = '未知';
    const userAgent = navigator.userAgent;
    
    // 简化的CPU检测 - 只基于平台信息
    if (navigator.platform) {
      if (navigator.platform.includes('Win32')) {
        cpuInfo = 'Windows x86_64';
      } else if (navigator.platform.includes('MacIntel')) {
        cpuInfo = 'Mac Intel';
      } else if (navigator.platform.includes('MacARM')) {
        cpuInfo = 'Mac ARM';
      } else if (navigator.platform.includes('Linux')) {
        cpuInfo = 'Linux x86_64';
      } else {
        cpuInfo = navigator.platform;
      }
    }
    
    // 如果平台信息也无法获取，则显示为未知
    if (cpuInfo === '未知') {
      cpuInfo = '无法检测';
    }
    
    output += `CPU类型: ${cpuInfo}\n`;
    output += `注意: CPU信息可能不准确，受浏览器API限制\n`;
    
    output += `连接类型: ${(navigator as any).connection ? (navigator as any).connection.effectiveType || '未知' : '未知'}\n`;
    
    output += '\n📱 屏幕信息:\n';
    output += '-'.repeat(30) + '\n';
    output += `屏幕分辨率: ${screen.width}x${screen.height}\n`;
    output += `可用屏幕: ${screen.availWidth}x${screen.availHeight}\n`;
    output += `颜色深度: ${screen.colorDepth}位\n`;
    output += `像素密度: ${window.devicePixelRatio || 1}\n`;
    output += `视口大小: ${window.innerWidth}x${window.innerHeight}\n`;
    
    // 添加更多屏幕信息
    output += `窗口大小: ${window.outerWidth}x${window.outerHeight}\n`;
    output += `缩放比例: ${window.devicePixelRatio || 1}\n`;
    
    // 尝试获取真实分辨率（考虑缩放）
    const realWidth = Math.round(screen.width * (window.devicePixelRatio || 1));
    const realHeight = Math.round(screen.height * (window.devicePixelRatio || 1));
    output += `实际分辨率: ${realWidth}x${realHeight}\n`;
    
    output += '\n🌐 浏览器信息:\n';
    output += '-'.repeat(30) + '\n';
    output += `Cookie启用: ${navigator.cookieEnabled ? '是' : '否'}\n`;
    output += `Do Not Track: ${navigator.doNotTrack || '未设置'}\n`;
    output += `地理位置: ${navigator.geolocation ? '支持' : '不支持'}\n`;
    output += `WebGL支持: ${(() => {
      try {
        const canvas = document.createElement('canvas');
        return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
      } catch (e) {
        return '检测失败';
      }
    })()}\n`;
    
    output += '\n⏰ 时间信息:\n';
    output += '-'.repeat(30) + '\n';
    output += `时区: ${Intl.DateTimeFormat().resolvedOptions().timeZone}\n`;
    output += `时区偏移: ${new Date().getTimezoneOffset()}分钟\n`;
    output += `本地时间: ${new Date().toLocaleString()}\n`;
    output += `UTC时间: ${new Date().toISOString()}\n`;
    
    output += '\n🔧 应用信息:\n';
    output += '-'.repeat(30) + '\n';
    const { version, build } = getVersionInfo();
    output += `应用版本: ${version}（构建 ${build}）\n`;
    output += `构建模式: ${process.env.NODE_ENV === 'development' ? '开发模式' : '生产模式'}\n`;
    output += `页面URL: ${window.location.href}\n`;
    output += `页面标题: ${document.title}\n`;
    output += `页面加载时间: ${performance.timing ? 
      `${performance.timing.loadEventEnd - performance.timing.navigationStart}ms` : 
      '不可用'}\n`;
    
    // 添加性能指标
    output += '\n📊 性能指标:\n';
    output += '-'.repeat(30) + '\n';
    if (performance.timing) {
      const timing = performance.timing;
      output += `DNS查询: ${timing.domainLookupEnd - timing.domainLookupStart}ms\n`;
      output += `TCP连接: ${timing.connectEnd - timing.connectStart}ms\n`;
      output += `请求响应: ${timing.responseEnd - timing.requestStart}ms\n`;
      output += `DOM解析: ${timing.domContentLoadedEventEnd - timing.domContentLoadedEventStart}ms\n`;
      output += `页面加载: ${timing.loadEventEnd - timing.loadEventStart}ms\n`;
    } else {
      output += '性能指标: 不可用\n';
    }
    
    // 添加存储信息
    output += '\n💾 存储信息:\n';
    output += '-'.repeat(30) + '\n';
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      output += '存储API: 支持\n';
      // 注意：由于异步限制，存储配额信息无法在同步报告中显示
      // 如需完整存储信息，请查看浏览器开发者工具
    } else {
      output += '存储API: 不支持\n';
    }
    
    // 添加本地存储信息
    try {
      const localStorageSize = JSON.stringify(localStorage).length;
      const sessionStorageSize = JSON.stringify(sessionStorage).length;
      output += `本地存储大小: ${Math.round(localStorageSize / 1024)}KB\n`;
      output += `会话存储大小: ${Math.round(sessionStorageSize / 1024)}KB\n`;
    } catch (e) {
      output += '本地存储信息: 无法获取\n';
    }
    
    output += '='.repeat(60) + '\n';
    output += '报告结束\n';
    output += '='.repeat(60) + '\n';
    
    return output;
  }

  /**
   * 重置监测器
   */
  reset(): void {
    this.metrics.clear();
    this.readiness = { historyVisible: null, composerEditable: null };
    this.currentPhase = null;
    this.phaseStack = [];
  }

  /**
   * 启用/禁用监测
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }
}

// 创建全局实例
export const startupMonitor = new StartupPerformanceMonitor();

// 在开发环境中暴露到全局
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as any).startupMonitor = startupMonitor;
  console.log('🔍 启动性能监测器已加载');
  console.log('使用方法:');
  console.log('  startupMonitor.printReport() - 打印性能报告');
  console.log('  startupMonitor.reset() - 重置监测器');
} 