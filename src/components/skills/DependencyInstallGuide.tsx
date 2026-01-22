'use client';

/**
 * 依赖安装引导组件
 * 
 * 当技能所需的依赖未安装时，显示友好的安装引导界面
 * 
 * 灵感来源：Claude Cowork 的环境自动检测与引导
 */

import React, { useState, useEffect } from 'react';
import { AlertCircle, Download, ExternalLink, Check, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DependencyCheckResult } from '@/lib/skills/dependencyChecker';
import { 
  checkAllCommonDependencies, 
  clearDependencyCache,
  openDownloadUrl,
} from '@/lib/skills/dependencyChecker';

/**
 * 组件属性
 */
interface DependencyInstallGuideProps {
  /** 依赖检测结果列表 */
  dependencies?: DependencyCheckResult[];
  /** 自动检测依赖 */
  autoCheck?: boolean;
  /** 检测完成回调 */
  onCheckComplete?: (results: DependencyCheckResult[]) => void;
  /** 紧凑模式 */
  compact?: boolean;
  /** 自定义类名 */
  className?: string;
}

/**
 * 单个依赖项展示
 */
interface DependencyItemProps {
  dependency: DependencyCheckResult;
  onRefresh?: () => void;
  compact?: boolean;
}

function DependencyItem({ dependency, onRefresh, compact }: DependencyItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOpening, setIsOpening] = useState(false);

  const handleOpenDownload = async () => {
    if (!dependency.downloadUrl) return;
    
    setIsOpening(true);
    try {
      await openDownloadUrl(dependency.downloadUrl);
    } finally {
      setTimeout(() => setIsOpening(false), 1000);
    }
  };

  return (
    <div 
      className={cn(
        "border rounded-lg transition-colors",
        dependency.installed 
          ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20"
          : "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20",
        compact ? "p-2" : "p-3"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {dependency.installed ? (
            <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
          ) : (
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          )}
          <span className={cn(
            "font-medium",
            compact ? "text-sm" : "text-base"
          )}>
            {dependency.name}
          </span>
          {dependency.version && (
            <span className="text-xs text-muted-foreground">
              v{dependency.version}
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-1">
          {!dependency.installed && dependency.downloadUrl && (
            <button
              onClick={handleOpenDownload}
              disabled={isOpening}
              className={cn(
                "flex items-center gap-1 px-2 py-1 text-xs font-medium rounded",
                "bg-primary text-primary-foreground hover:bg-primary/90",
                "transition-colors disabled:opacity-50"
              )}
            >
              {isOpening ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <Download className="w-3 h-3" />
              )}
              <span>下载</span>
            </button>
          )}
          
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="p-1 text-muted-foreground hover:text-foreground rounded"
              title="重新检测"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
          
          {!dependency.installed && dependency.installHint && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 text-muted-foreground hover:text-foreground rounded"
            >
              {isExpanded ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
      </div>
      
      {/* 安装说明展开区 */}
      {!dependency.installed && isExpanded && dependency.installHint && (
        <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-800">
          <p className="text-xs text-muted-foreground whitespace-pre-wrap">
            {dependency.installHint}
          </p>
          {dependency.downloadUrl && (
            <a
              href={dependency.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 mt-2 text-xs text-primary hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              官方下载页面
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 依赖安装引导组件
 */
export function DependencyInstallGuide({
  dependencies: initialDependencies,
  autoCheck = true,
  onCheckComplete,
  compact = false,
  className,
}: DependencyInstallGuideProps) {
  const [dependencies, setDependencies] = useState<DependencyCheckResult[]>(
    initialDependencies || []
  );
  const [isChecking, setIsChecking] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState<number | null>(null);

  // 自动检测依赖
  useEffect(() => {
    if (autoCheck && !initialDependencies) {
      checkDependencies();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheck, initialDependencies]);

  const checkDependencies = async () => {
    setIsChecking(true);
    try {
      const results = await checkAllCommonDependencies();
      setDependencies(results);
      setLastCheckTime(Date.now());
      onCheckComplete?.(results);
    } finally {
      setIsChecking(false);
    }
  };

  const handleRefreshAll = async () => {
    clearDependencyCache();
    await checkDependencies();
  };

  const allInstalled = dependencies.every(d => d.installed);
  const missingCount = dependencies.filter(d => !d.installed).length;

  if (dependencies.length === 0) {
    return null;
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className={cn(
            "font-semibold",
            compact ? "text-sm" : "text-base"
          )}>
            运行环境
          </h3>
          {allInstalled ? (
            <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
              <Check className="w-3 h-3" />
              就绪
            </span>
          ) : (
            <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              <AlertCircle className="w-3 h-3" />
              缺少 {missingCount} 项
            </span>
          )}
        </div>
        
        <button
          onClick={handleRefreshAll}
          disabled={isChecking}
          className={cn(
            "flex items-center gap-1 px-2 py-1 text-xs rounded",
            "text-muted-foreground hover:text-foreground hover:bg-muted",
            "transition-colors disabled:opacity-50"
          )}
        >
          <RefreshCw className={cn("w-3 h-3", isChecking && "animate-spin")} />
          <span>刷新</span>
        </button>
      </div>

      {/* 依赖列表 */}
      <div className="space-y-2">
        {dependencies.map((dep) => (
          <DependencyItem
            key={`${dep.type}-${dep.name}`}
            dependency={dep}
            compact={compact}
          />
        ))}
      </div>

      {/* 上次检测时间 */}
      {lastCheckTime && (
        <p className="text-xs text-muted-foreground text-center">
          上次检测: {new Date(lastCheckTime).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}

/**
 * 简化版依赖状态指示器
 * 
 * 用于在技能列表中快速显示依赖状态
 */
export function DependencyStatusBadge({
  dependencies,
  className,
}: {
  dependencies: DependencyCheckResult[];
  className?: string;
}) {
  const allInstalled = dependencies.every(d => d.installed);
  const missingCount = dependencies.filter(d => !d.installed).length;

  if (dependencies.length === 0) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded",
        allInstalled
          ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
          : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
        className
      )}
      title={allInstalled ? "所有依赖已就绪" : `缺少 ${missingCount} 项依赖`}
    >
      {allInstalled ? (
        <Check className="w-3 h-3" />
      ) : (
        <>
          <AlertCircle className="w-3 h-3" />
          <span>{missingCount}</span>
        </>
      )}
    </span>
  );
}

export default DependencyInstallGuide;

