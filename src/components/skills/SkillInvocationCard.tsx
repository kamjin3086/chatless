"use client";

/**
 * 技能调用卡片组件
 * 
 * 在对话中显示技能调用的状态和结果
 * 
 * ## 设计说明
 * 
 * 当 AI 调用技能时，这个卡片会显示：
 * - 技能名称和图标
 * - 当前执行状态（运行中/完成/失败）
 * - 进度指示器
 * - 结果预览
 */

import React, { useMemo } from 'react';
import { 
  Sparkles, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  RotateCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { SkillExecutionStatus } from '@/lib/skills';

export interface SkillInvocationCardProps {
  /** 技能 ID */
  skillId: string;
  /** 技能名称 */
  skillName: string;
  /** 执行状态 */
  status: SkillExecutionStatus;
  /** 执行开始时间 */
  startTime?: number;
  /** 执行结束时间 */
  endTime?: number;
  /** 当前尝试次数 */
  attempts?: number;
  /** 最大尝试次数 */
  maxAttempts?: number;
  /** 错误信息 */
  errorMessage?: string;
  /** 结果预览 */
  resultPreview?: string;
  /** 是否展开详情 */
  isExpanded?: boolean;
  /** 展开/折叠回调 */
  onToggleExpand?: () => void;
  /** 重试回调 */
  onRetry?: () => void;
  /** 取消回调 */
  onCancel?: () => void;
  /** 额外的 className */
  className?: string;
}

/**
 * 状态配置
 */
const STATUS_CONFIG: Record<SkillExecutionStatus, {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color: string;
  bgColor: string;
  animate?: boolean;
}> = {
  idle: {
    icon: Clock,
    label: '等待中',
    color: 'text-slate-500',
    bgColor: 'bg-slate-100 dark:bg-slate-800',
  },
  pre_execute: {
    icon: Loader2,
    label: '准备中',
    color: 'text-blue-500',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    animate: true,
  },
  executing: {
    icon: Loader2,
    label: '执行中',
    color: 'text-purple-500',
    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
    animate: true,
  },
  verifying: {
    icon: Loader2,
    label: '验证中',
    color: 'text-amber-500',
    bgColor: 'bg-amber-50 dark:bg-amber-900/20',
    animate: true,
  },
  post_execute: {
    icon: Loader2,
    label: '收尾中',
    color: 'text-blue-500',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    animate: true,
  },
  completed: {
    icon: CheckCircle2,
    label: '完成',
    color: 'text-green-500',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
  },
  failed: {
    icon: XCircle,
    label: '失败',
    color: 'text-red-500',
    bgColor: 'bg-red-50 dark:bg-red-900/20',
  },
  cancelled: {
    icon: AlertTriangle,
    label: '已取消',
    color: 'text-slate-500',
    bgColor: 'bg-slate-100 dark:bg-slate-800',
  },
};

/**
 * 技能调用卡片
 */
export const SkillInvocationCard: React.FC<SkillInvocationCardProps> = ({
  skillId,
  skillName,
  status,
  startTime,
  endTime,
  attempts,
  maxAttempts,
  errorMessage,
  resultPreview,
  isExpanded = false,
  onToggleExpand,
  onRetry,
  onCancel,
  className,
}) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.idle;
  const StatusIcon = config.icon;
  
  // 计算执行时长
  const duration = useMemo(() => {
    if (!startTime) return null;
    const end = endTime || Date.now();
    const ms = end - startTime;
    
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  }, [startTime, endTime]);
  
  const isRunning = ['pre_execute', 'executing', 'verifying', 'post_execute'].includes(status);
  const isFailed = status === 'failed';
  const isCompleted = status === 'completed';
  
  return (
    <div 
      className={cn(
        "rounded-lg border transition-all duration-200",
        config.bgColor,
        isRunning && "border-purple-300 dark:border-purple-700",
        isCompleted && "border-green-300 dark:border-green-700",
        isFailed && "border-red-300 dark:border-red-700",
        !isRunning && !isCompleted && !isFailed && "border-slate-200 dark:border-slate-700",
        className
      )}
    >
      {/* 头部 */}
      <div 
        className="flex items-center justify-between p-3 cursor-pointer"
        onClick={onToggleExpand}
      >
        <div className="flex items-center gap-3">
          {/* 技能图标 */}
          <div className={cn(
            "flex items-center justify-center w-8 h-8 rounded-lg",
            "bg-slate-100/80 dark:bg-slate-800/60",
            "text-slate-600 dark:text-slate-300"
          )}>
            <Sparkles className="w-4 h-4" />
          </div>
          
          {/* 技能信息 */}
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm text-slate-900 dark:text-slate-100">
                {skillName}
              </span>
              <Badge variant="outline" className="text-xs">
                {skillId}
              </Badge>
            </div>
            
            {/* 状态和时间 */}
            <div className="flex items-center gap-2 mt-0.5">
              <StatusIcon 
                className={cn(
                  "w-3.5 h-3.5",
                  config.color,
                  config.animate && "animate-spin"
                )} 
              />
              <span className={cn("text-xs", config.color)}>
                {config.label}
              </span>
              
              {duration && (
                <>
                  <span className="text-slate-300 dark:text-slate-600">•</span>
                  <span className="text-xs text-slate-500">{duration}</span>
                </>
              )}
              
              {attempts && maxAttempts && attempts > 1 && (
                <>
                  <span className="text-slate-300 dark:text-slate-600">•</span>
                  <span className="text-xs text-slate-500">
                    尝试 {attempts}/{maxAttempts}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        
        {/* 右侧操作 */}
        <div className="flex items-center gap-2">
          {isRunning && onCancel && (
            <Button 
              variant="ghost" 
              size="sm"
              onClick={(e) => { e.stopPropagation(); onCancel(); }}
              className="h-7 text-xs"
            >
              取消
            </Button>
          )}
          
          {isFailed && onRetry && (
            <Button 
              variant="ghost" 
              size="sm"
              onClick={(e) => { e.stopPropagation(); onRetry(); }}
              className="h-7 text-xs"
            >
              <RotateCw className="w-3 h-3 mr-1" />
              重试
            </Button>
          )}
          
          {onToggleExpand && (
            isExpanded ? (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )
          )}
        </div>
      </div>
      
      {/* 展开的详情 */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-0 border-t border-slate-200/50 dark:border-slate-700/50">
          {/* 错误信息 */}
          {errorMessage && (
            <div className="mt-2 p-2 rounded-md bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-xs">
              <strong>错误:</strong> {errorMessage}
            </div>
          )}
          
          {/* 结果预览 */}
          {resultPreview && (
            <div className="mt-2 p-2 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-mono overflow-x-auto">
              {resultPreview}
            </div>
          )}
          
          {/* 无内容时显示占位 */}
          {!errorMessage && !resultPreview && (
            <div className="mt-2 text-xs text-slate-400 dark:text-slate-500">
              {isRunning ? '执行中...' : '无详细信息'}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * 技能调用卡片骨架屏
 */
export const SkillInvocationCardSkeleton: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <div 
      className={cn(
        "rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3",
        "animate-pulse",
        className
      )}
    >
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-slate-300 dark:bg-slate-600" />
        <div className="flex flex-col gap-1.5">
          <div className="h-4 w-32 bg-slate-300 dark:bg-slate-600 rounded-md" />
          <div className="h-3 w-20 bg-slate-200 dark:bg-slate-700 rounded-md" />
        </div>
      </div>
    </div>
  );
};

export default SkillInvocationCard;

