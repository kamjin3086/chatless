"use client";

import React from 'react';
import { translate } from '@/i18n';
import type { TranslationKey } from '@/i18n/types';
import { useLocaleStore } from '@/store/localeStore';
import { cn } from '@/lib/utils';
import { useSkillAuthStore } from '@/store/skillAuthStore';
import { SkillActionCard } from './SkillActionCard';
import { AlertTriangle, CheckCircle2, XCircle, Clock } from 'lucide-react';

interface SkillApprovalPanelProps {
  /** 自定义类名 */
  className?: string;
  /** 是否显示为浮动面板 */
  floating?: boolean;
  /** 最大显示数量 */
  maxItems?: number;
}

/**
 * Skill 审批面板
 * 
 * 集中展示和管理所有待审批的 Skill 动作
 */
export function SkillApprovalPanel({
  className,
  floating = false,
  maxItems = 5,
}: SkillApprovalPanelProps) {
  const locale = useLocaleStore((state) => state.locale);
  const t = (key: TranslationKey) => translate(locale, key);
  const { 
    getAllPendingActions, 
    clearAllPendingActions,
    approveAction,
    rejectAction,
  } = useSkillAuthStore();

  const pendingActions = getAllPendingActions();
  
  // 如果没有待审批的动作，不显示面板
  if (pendingActions.length === 0) {
    return null;
  }

  const displayActions = pendingActions.slice(0, maxItems);
  const moreActions = pendingActions.length - maxItems;

  // 批量操作
  const handleApproveAll = () => {
    for (const action of pendingActions) {
      approveAction(action.id);
    }
  };

  const handleRejectAll = () => {
    clearAllPendingActions();
  };

  return (
    <div className={cn(
      'rounded-lg border border-yellow-200/60 dark:border-yellow-800/40',
      'bg-yellow-50/50 dark:bg-yellow-950/20',
      'overflow-hidden',
      floating && 'fixed bottom-4 right-4 w-96 max-h-[80vh] shadow-lg z-50',
      className
    )}>
      {/* 头部 */}
      <div className="px-4 py-3 border-b border-yellow-200/60 dark:border-yellow-800/40 bg-yellow-100/50 dark:bg-yellow-900/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
            <h3 className="font-semibold text-yellow-800 dark:text-yellow-200">
              {t('skillApproval.title')}
            </h3>
            <span className="px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-yellow-200 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200">
              {pendingActions.length}
            </span>
          </div>
          
          {/* 批量操作按钮 */}
          {pendingActions.length > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleApproveAll}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-green-100 hover:bg-green-200 dark:bg-green-900/30 dark:hover:bg-green-900/50 text-green-700 dark:text-green-300 transition-colors"
                title={t('skillApproval.approveAll')}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                {t('skillApproval.approveAll')}
              </button>
              <button
                onClick={handleRejectAll}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 transition-colors"
                title={t('skillApproval.rejectAll')}
              >
                <XCircle className="w-3.5 h-3.5" />
                {t('skillApproval.rejectAll')}
              </button>
            </div>
          )}
        </div>
        
        <p className="mt-1 text-[12px] text-yellow-700 dark:text-yellow-400">
          {t('skillApproval.description')}
        </p>
      </div>

      {/* 待审批列表 */}
      <div className="p-3 space-y-2 max-h-96 overflow-y-auto">
        {displayActions.map((pending) => (
          <SkillActionCard
            key={pending.id}
            skillId={pending.skillId}
            skillName={pending.skillName}
            action={pending.action}
            resolvedCommand={pending.resolvedCommand}
            resolvedArgs={pending.resolvedArgs}
            status="awaiting_approval"
            pendingActionId={pending.id}
            allowEdit={true}
          />
        ))}

        {/* 更多提示 */}
        {moreActions > 0 && (
          <div className="flex items-center justify-center gap-2 py-2 text-[12px] text-yellow-600 dark:text-yellow-400">
            <Clock className="w-4 h-4" />
            <span>
              {t(moreActions === 1 ? 'skillApproval.moreActions.one' : 'skillApproval.moreActions.other').replace('{count}', String(moreActions))}
            </span>
          </div>
        )}
      </div>

      {/* 底部提示 */}
      <div className="px-4 py-2 border-t border-yellow-200/60 dark:border-yellow-800/40 bg-yellow-100/30 dark:bg-yellow-900/10">
        <p className="text-[11px] text-yellow-600 dark:text-yellow-400 text-center">
          {t('skillApproval.tip')}
        </p>
      </div>
    </div>
  );
}

/**
 * 浮动审批面板
 * 
 * 用于在聊天界面中显示待审批操作
 */
export function FloatingSkillApprovalPanel() {
  return <SkillApprovalPanel floating={true} />;
}

/**
 * 内嵌审批面板
 * 
 * 用于在消息中内嵌显示
 */
export function InlineSkillApprovalPanel({
  className,
}: {
  className?: string;
}) {
  return <SkillApprovalPanel className={className} floating={false} />;
}

