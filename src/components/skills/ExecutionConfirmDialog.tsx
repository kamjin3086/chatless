'use client';

/**
 * 执行确认对话框
 * 
 * 在执行敏感操作前请求用户确认
 * 实现 Human-in-the-loop 机制
 */

import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Shield, ShieldAlert, ShieldCheck, Clock, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { 
  ConfirmationRequest, 
  ConfirmationResult, 
  IConfirmationHandler,
  RiskLevel,
} from '@/lib/skills/sandbox';
import { getConfirmationManager } from '@/lib/skills/sandbox';

/**
 * 风险等级配置
 */
const RISK_CONFIG: Record<RiskLevel, {
  icon: React.ElementType;
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
}> = {
  safe: {
    icon: ShieldCheck,
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
    borderColor: 'border-green-200 dark:border-green-800',
    label: '安全',
  },
  low: {
    icon: Shield,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    borderColor: 'border-blue-200 dark:border-blue-800',
    label: '低风险',
  },
  medium: {
    icon: Shield,
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-900/20',
    borderColor: 'border-amber-200 dark:border-amber-800',
    label: '中等风险',
  },
  high: {
    icon: ShieldAlert,
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-50 dark:bg-orange-900/20',
    borderColor: 'border-orange-200 dark:border-orange-800',
    label: '高风险',
  },
  critical: {
    icon: AlertTriangle,
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-900/20',
    borderColor: 'border-red-200 dark:border-red-800',
    label: '关键风险',
  },
};

/**
 * 组件属性
 */
interface ExecutionConfirmDialogProps {
  /** 是否自动注册为确认处理器 */
  autoRegister?: boolean;
  /** 自定义类名 */
  className?: string;
}

/**
 * 内部状态
 */
interface DialogState {
  isOpen: boolean;
  request: ConfirmationRequest | null;
  resolver: ((result: ConfirmationResult) => void) | null;
  remainingTime: number;
}

/**
 * 执行确认对话框组件
 */
export function ExecutionConfirmDialog({
  autoRegister = true,
  className,
}: ExecutionConfirmDialogProps) {
  const [state, setState] = useState<DialogState>({
    isOpen: false,
    request: null,
    resolver: null,
    remainingTime: 0,
  });

  // 处理确认请求
  const handleConfirmation = useCallback((request: ConfirmationRequest): Promise<ConfirmationResult> => {
    return new Promise((resolve) => {
      setState({
        isOpen: true,
        request,
        resolver: resolve,
        remainingTime: Math.floor(request.timeoutMs / 1000),
      });
    });
  }, []);

  // 取消确认
  const handleCancel = useCallback((requestId: string) => {
    setState(prev => {
      if (prev.request?.requestId === requestId) {
        prev.resolver?.({
          confirmed: false,
          action: 'deny',
          feedback: '请求已取消',
        });
        return {
          isOpen: false,
          request: null,
          resolver: null,
          remainingTime: 0,
        };
      }
      return prev;
    });
  }, []);

  // 注册确认处理器
  useEffect(() => {
    if (!autoRegister) return;

    const handler: IConfirmationHandler = {
      requestConfirmation: handleConfirmation,
      cancelConfirmation: handleCancel,
    };

    const manager = getConfirmationManager();
    manager.setHandler(handler);

    return () => {
      // 清理时恢复默认处理器
    };
  }, [autoRegister, handleConfirmation, handleCancel]);

  // 倒计时
  useEffect(() => {
    if (!state.isOpen || state.remainingTime <= 0) return;

    const timer = setInterval(() => {
      setState(prev => {
        const newTime = prev.remainingTime - 1;
        if (newTime <= 0) {
          // 超时
          prev.resolver?.({
            confirmed: false,
            action: 'timeout',
            feedback: '确认超时',
          });
          return {
            isOpen: false,
            request: null,
            resolver: null,
            remainingTime: 0,
          };
        }
        return { ...prev, remainingTime: newTime };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [state.isOpen, state.remainingTime]);

  // 处理用户选择
  const handleAction = (action: ConfirmationResult['action']) => {
    if (!state.resolver) return;

    state.resolver({
      confirmed: action === 'allow' || action === 'allow_once' || action === 'allow_always',
      action,
    });

    setState({
      isOpen: false,
      request: null,
      resolver: null,
      remainingTime: 0,
    });
  };

  if (!state.isOpen || !state.request) {
    return null;
  }

  const { request, remainingTime } = state;
  const riskConfig = RISK_CONFIG[request.riskLevel];
  const RiskIcon = riskConfig.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 glass-scrim bg-black/60 backdrop-blur-sm">
      <div 
        className={cn(
          "w-full max-w-md rounded-lg shadow-xl glass-overlay",
          "bg-background border",
          riskConfig.borderColor,
          className
        )}
      >
        {/* 头部 */}
        <div className={cn(
          "flex items-center gap-3 p-4 border-b rounded-t-lg",
          riskConfig.bgColor,
          riskConfig.borderColor
        )}>
          <RiskIcon className={cn("w-6 h-6", riskConfig.color)} />
          <div className="flex-1">
            <h2 className="font-semibold text-lg">执行确认</h2>
            <p className={cn("text-sm", riskConfig.color)}>
              {riskConfig.label}操作
            </p>
          </div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Clock className="w-4 h-4" />
            <span>{remainingTime}s</span>
          </div>
        </div>

        {/* 内容 */}
        <div className="p-4 space-y-4">
          {/* 命令 */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-muted-foreground">
              命令
            </label>
            <div className={cn(
              "flex items-start gap-2 p-3 rounded-md",
              "bg-muted font-mono text-sm"
            )}>
              <Terminal className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
              <code className="break-all">{request.command}</code>
            </div>
          </div>

          {/* 描述 */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-muted-foreground">
              说明
            </label>
            <p className="text-sm">{request.description}</p>
          </div>

          {/* 影响 */}
          {request.impact.length > 0 && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground">
                潜在影响
              </label>
              <ul className="space-y-1">
                {request.impact.map((item, index) => (
                  <li 
                    key={index}
                    className={cn(
                      "flex items-start gap-2 text-sm",
                      riskConfig.color
                    )}
                  >
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-current shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 建议 */}
          {request.suggestion && (
            <div className={cn(
              "p-3 rounded-md text-sm",
              "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300"
            )}>
              💡 {request.suggestion}
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 p-4 border-t bg-muted/30">
          <button
            onClick={() => handleAction('deny')}
            className={cn(
              "flex-1 px-4 py-2 text-sm font-medium rounded-md",
              "border border-input bg-background hover:bg-accent",
              "transition-colors"
            )}
          >
            拒绝
          </button>
          <button
            onClick={() => handleAction('allow_once')}
            className={cn(
              "flex-1 px-4 py-2 text-sm font-medium rounded-md",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "transition-colors"
            )}
          >
            允许一次
          </button>
          <button
            onClick={() => handleAction('allow_always')}
            className={cn(
              "px-4 py-2 text-sm font-medium rounded-md",
              "bg-green-600 text-white hover:bg-green-700",
              "transition-colors"
            )}
          >
            始终允许
          </button>
        </div>
      </div>
    </div>
  );
}

export default ExecutionConfirmDialog;

