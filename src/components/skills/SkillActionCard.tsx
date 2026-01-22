"use client";

import React, { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { 
  Check, 
  X, 
  Terminal, 
  Code, 
  FileText, 
  Zap, 
  BookOpen,
  Layers,
  Edit3,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Play,
  Loader2,
} from 'lucide-react';
import { useSkillAuthStore, getRiskLevelInfo } from '@/store/skillAuthStore';
import type { 
  SkillAction, 
  SkillActionType, 
  SkillRiskLevel,
  SkillActionStatus,
} from '@/lib/skills/types';

/**
 * 动作类型图标配置
 */
const ACTION_TYPE_ICONS: Record<SkillActionType, React.ElementType> = {
  shell: Terminal,
  script: Code,
  file: FileText,
  mcp_tool: Zap,
  instruction: BookOpen,
  composite: Layers,
};

/**
 * 动作类型标签
 */
const ACTION_TYPE_LABELS: Record<SkillActionType, string> = {
  shell: 'Shell',
  script: '脚本',
  file: '文件',
  mcp_tool: 'MCP',
  instruction: '指令',
  composite: '组合',
};

interface SkillActionCardProps {
  /** Skill ID */
  skillId: string;
  /** Skill 名称 */
  skillName: string;
  /** 动作定义 */
  action: SkillAction;
  /** 解析后的命令 */
  resolvedCommand?: string;
  /** 解析后的参数 */
  resolvedArgs?: string[];
  /** 状态 */
  status: SkillActionStatus;
  /** 结果输出 */
  output?: string;
  /** 错误信息 */
  errorMessage?: string;
  /** 待审批动作 ID（用于授权操作） */
  pendingActionId?: string;
  /** 是否允许编辑命令 */
  allowEdit?: boolean;
  /** 编辑后的命令变更回调 */
  onCommandChange?: (command: string) => void;
}

export function SkillActionCard({
  skillId,
  skillName,
  action,
  resolvedCommand,
  resolvedArgs,
  status,
  output,
  errorMessage,
  pendingActionId,
  allowEdit = true,
  onCommandChange,
}: SkillActionCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedCommand, setEditedCommand] = useState(resolvedCommand || action.command || '');
  
  const { 
    approveAction, 
    rejectAction, 
    modifyAndApproveAction,
    hasPendingAction,
  } = useSkillAuthStore();

  // 判断是否是等待审批状态
  const isAwaitingApproval = status === 'awaiting_approval' || 
    (pendingActionId && hasPendingAction(pendingActionId));

  // 获取动作类型图标
  const TypeIcon = ACTION_TYPE_ICONS[action.type] || Terminal;
  const typeLabel = ACTION_TYPE_LABELS[action.type] || action.type;
  
  // 获取风险等级信息
  const riskLevel = action.riskLevel || 'medium';
  const riskInfo = getRiskLevelInfo(riskLevel);

  // 显示的命令
  const displayCommand = resolvedCommand || action.command || '';
  const displayArgs = resolvedArgs || action.args || [];

  // 处理批准
  const handleApprove = useCallback(() => {
    if (pendingActionId) {
      if (isEditing && editedCommand !== displayCommand) {
        modifyAndApproveAction(pendingActionId, editedCommand);
      } else {
        approveAction(pendingActionId);
      }
      setIsEditing(false);
    }
  }, [pendingActionId, isEditing, editedCommand, displayCommand, approveAction, modifyAndApproveAction]);

  // 处理拒绝
  const handleReject = useCallback(() => {
    if (pendingActionId) {
      rejectAction(pendingActionId);
    }
  }, [pendingActionId, rejectAction]);

  // 处理编辑
  const handleStartEdit = useCallback(() => {
    setIsEditing(true);
    setEditedCommand(displayCommand);
  }, [displayCommand]);

  // 处理取消编辑
  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditedCommand(displayCommand);
  }, [displayCommand]);

  // 获取状态样式
  const getStatusStyles = () => {
    switch (status) {
      case 'completed':
        return 'border-green-300/50 bg-green-50/40 dark:border-green-800/50 dark:bg-green-950/20';
      case 'failed':
        return 'border-red-300/50 bg-red-50/40 dark:border-red-800/50 dark:bg-red-950/20';
      case 'running':
        return 'border-blue-300/50 bg-blue-50/40 dark:border-blue-800/50 dark:bg-blue-950/20';
      case 'awaiting_approval':
        return 'border-yellow-300/50 bg-yellow-50/40 dark:border-yellow-800/50 dark:bg-yellow-950/20';
      case 'rejected':
        return 'border-orange-300/50 bg-orange-50/40 dark:border-orange-800/50 dark:bg-orange-950/20';
      case 'skipped':
        return 'border-slate-300/50 bg-slate-50/40 dark:border-slate-700/50 dark:bg-slate-800/20';
      default:
        return 'border-slate-300/40 bg-slate-50/40 dark:border-slate-700/40 dark:bg-slate-800/40';
    }
  };

  return (
    <div className={cn(
      'w-full rounded-lg border-[1.5px] text-sm overflow-hidden transition-all duration-300',
      getStatusStyles()
    )}>
      {/* 头部 */}
      <div 
        className="px-3.5 py-2.5 flex items-center gap-2.5 border-b border-slate-200/40 dark:border-slate-700/40 bg-white/20 dark:bg-slate-900/10 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* 类型图标 */}
        <div className={cn(
          'flex items-center justify-center w-6 h-6 rounded',
          'bg-slate-100/60 dark:bg-slate-800/60'
        )}>
          <TypeIcon className="w-4 h-4 text-slate-600 dark:text-slate-400" />
        </div>

        {/* Skill 和动作名称 */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="font-semibold truncate text-slate-800 dark:text-slate-200">
            {skillName}
          </span>
          <span className="text-slate-400 dark:text-slate-600">·</span>
          <span className="font-mono text-[12px] truncate text-slate-700 dark:text-slate-300 font-medium">
            {action.name}
          </span>
        </div>

        {/* 类型标签 */}
        <span className={cn(
          'px-1.5 py-0.5 rounded text-[10px] font-semibold',
          'bg-slate-100/60 dark:bg-slate-800/60',
          'text-slate-600 dark:text-slate-400'
        )}>
          {typeLabel}
        </span>

        {/* 风险等级 */}
        {riskLevel !== 'safe' && (
          <span className={cn(
            'px-1.5 py-0.5 rounded text-[10px] font-semibold',
            riskInfo.bgColor,
            riskInfo.color
          )}>
            {riskInfo.label}
          </span>
        )}

        {/* 状态指示器 */}
        <div className="flex items-center gap-1.5">
          {status === 'running' && (
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
          )}
          {status === 'completed' && (
            <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
          )}
          {status === 'failed' && (
            <X className="w-4 h-4 text-red-600 dark:text-red-400" />
          )}
          {status === 'rejected' && (
            <X className="w-4 h-4 text-orange-600 dark:text-orange-400" />
          )}
          {isAwaitingApproval && (
            <div className="relative flex items-center justify-center w-2 h-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500 shadow-sm" />
            </div>
          )}
        </div>

        {/* 展开/折叠按钮 */}
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </div>

      {/* 审批按钮区域（等待审批时显示在头部下方） */}
      {isAwaitingApproval && (
        <div className="px-3.5 py-2 flex items-center justify-between border-b border-slate-200/40 dark:border-slate-700/40 bg-yellow-50/30 dark:bg-yellow-950/10">
          <div className="flex items-center gap-2 text-[12px] text-yellow-700 dark:text-yellow-400">
            <AlertTriangle className="w-4 h-4" />
            <span>此操作需要您的确认</span>
          </div>
          <div className="flex items-center gap-1.5">
            {allowEdit && !isEditing && (
              <button
                onClick={(e) => { e.stopPropagation(); handleStartEdit(); }}
                className="flex items-center gap-0.5 px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-all duration-200 cursor-pointer"
                title="编辑命令"
              >
                <Edit3 className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
                <span className="text-[11px] text-slate-700 dark:text-slate-300 font-semibold">编辑</span>
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); handleApprove(); }}
              className="flex items-center gap-0.5 px-2.5 py-1 rounded-md bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md active:scale-95"
              title="确认执行"
            >
              <Play className="w-3.5 h-3.5 text-white" />
              <span className="text-[11px] text-white font-semibold">
                {isEditing ? '保存并执行' : '执行'}
              </span>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleReject(); }}
              className="flex items-center gap-0.5 px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md active:scale-95"
              title="拒绝执行"
            >
              <X className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
              <span className="text-[11px] text-slate-700 dark:text-slate-300 font-semibold">取消</span>
            </button>
          </div>
        </div>
      )}

      {/* 展开内容 */}
      {isExpanded && (
        <div className="px-3.5 py-2.5 space-y-3">
          {/* 命令显示/编辑 */}
          {(displayCommand || action.type === 'shell' || action.type === 'script') && (
            <div>
              <div className="mb-1.5 font-semibold text-slate-800 dark:text-slate-200 text-[12px]">
                命令
                {action.workingDir && (
                  <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
                    (工作目录: {action.workingDir})
                  </span>
                )}
              </div>
              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    value={editedCommand}
                    onChange={(e) => setEditedCommand(e.target.value)}
                    className="w-full h-24 p-2.5 text-[12px] font-mono bg-slate-100/50 dark:bg-slate-900/30 rounded-lg border border-slate-200/50 dark:border-slate-800/50 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCancelEdit(); }}
                      className="px-2 py-1 text-[11px] rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
                    >
                      取消编辑
                    </button>
                  </div>
                </div>
              ) : (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-[12px] bg-slate-100/50 dark:bg-slate-900/30 rounded-lg p-2.5 border border-slate-200/50 dark:border-slate-800/50 font-mono">
                  {displayCommand}
                  {displayArgs.length > 0 && ` ${displayArgs.join(' ')}`}
                </pre>
              )}
            </div>
          )}

          {/* 动作描述 */}
          {action.description && (
            <div>
              <div className="mb-1.5 font-semibold text-slate-800 dark:text-slate-200 text-[12px]">
                描述
              </div>
              <p className="text-[12px] text-slate-700 dark:text-slate-300">
                {action.description}
              </p>
            </div>
          )}

          {/* 脚本内容（如果有） */}
          {action.scriptContent && (
            <div>
              <div className="mb-1.5 font-semibold text-slate-800 dark:text-slate-200 text-[12px]">
                脚本内容
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-[12px] bg-slate-100/50 dark:bg-slate-900/30 rounded-lg p-2.5 border border-slate-200/50 dark:border-slate-800/50 font-mono">
                {action.scriptContent}
              </pre>
            </div>
          )}

          {/* 输出结果 */}
          {output && status === 'completed' && (
            <div>
              <div className="mb-1.5 font-semibold text-green-800 dark:text-green-200 text-[12px]">
                输出结果
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-[12px] bg-green-50/50 dark:bg-green-950/20 rounded-lg p-2.5 border border-green-200/50 dark:border-green-800/50 font-mono text-green-800 dark:text-green-300">
                {output}
              </pre>
            </div>
          )}

          {/* 错误信息 */}
          {errorMessage && status === 'failed' && (
            <div>
              <div className="mb-1.5 font-semibold text-red-800 dark:text-red-200 text-[12px]">
                错误信息
              </div>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all text-[12px] bg-red-50/50 dark:bg-red-950/20 rounded-lg p-2.5 border border-red-200/50 dark:border-red-800/50 font-mono text-red-800 dark:text-red-300">
                {errorMessage}
              </pre>
            </div>
          )}

          {/* 风险说明 */}
          {riskLevel !== 'safe' && isAwaitingApproval && (
            <div className={cn(
              'p-2.5 rounded-lg text-[12px]',
              riskInfo.bgColor
            )}>
              <div className="flex items-center gap-1.5 mb-1">
                <AlertTriangle className={cn('w-4 h-4', riskInfo.color)} />
                <span className={cn('font-semibold', riskInfo.color)}>
                  {riskInfo.label}
                </span>
              </div>
              <p className={cn('text-[11px]', riskInfo.color.replace('600', '700').replace('400', '300'))}>
                {riskInfo.description}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

