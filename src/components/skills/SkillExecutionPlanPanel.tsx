"use client";

import React, { useMemo, useState } from 'react';
import { getHtmlLang, translate } from '@/i18n';
import type { Locale, TranslationKey } from '@/i18n/types';
import { useLocaleStore } from '@/store/localeStore';
import { getRiskLevelInfo } from '@/store/skillAuthStore';
import { cn } from '@/lib/utils';
import { useSkillExecutionPlanStore, type SkillExecutionPlanDraft } from '@/store/skillExecutionPlanStore';
import { executeSkillTool } from '@/lib/skills/skillTools';
import { Play, Trash2, ListChecks, ChevronDown, ChevronUp, Loader2, CheckCircle2, XCircle } from 'lucide-react';

interface SkillExecutionPlanPanelProps {
  className?: string;
  floating?: boolean;
  maxItems?: number;
}

function StatusBadge({ status, locale }: { status: SkillExecutionPlanDraft['status']; locale: Locale }) {
  const cfg = (() => {
    switch (status) {
      case 'draft':
        return { label: translate(locale, 'skillPlan.status.draft'), cls: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300' };
      case 'awaiting_approval':
        return { label: translate(locale, 'skillPlan.status.awaitingApproval'), cls: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300' };
      case 'running':
        return { label: translate(locale, 'skillPlan.status.running'), cls: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' };
      case 'completed':
        return { label: translate(locale, 'skillPlan.status.completed'), cls: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' };
      case 'failed':
        return { label: translate(locale, 'skillPlan.status.failed'), cls: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' };
      case 'cancelled':
        return { label: translate(locale, 'skillPlan.status.cancelled'), cls: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' };
      default:
        return { label: status, cls: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300' };
    }
  })();

  return (
    <span className={cn('px-1.5 py-0.5 rounded-md text-[10px] font-semibold', cfg.cls)}>
      {cfg.label}
    </span>
  );
}

export function SkillExecutionPlanPanel({ className, floating = false, maxItems = 3 }: SkillExecutionPlanPanelProps) {
  const locale = useLocaleStore((state) => state.locale);
  const t = (key: TranslationKey) => translate(locale, key);
  const { getAllPlans, removePlan, updatePlan } = useSkillExecutionPlanStore();
  const plans = getAllPlans();

  const displayPlans = useMemo(() => plans.slice(0, maxItems), [plans, maxItems]);
  const hasMore = plans.length > maxItems;

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runningPlanId, setRunningPlanId] = useState<string | null>(null);

  if (plans.length === 0) return null;

  const handleRun = async (planId: string) => {
    try {
      setRunningPlanId(planId);
      updatePlan(planId, { status: 'running', errorMessage: undefined });
      const res: any = await executeSkillTool('execute_execution_plan', { planId });
      if (res?.success) {
        updatePlan(planId, { status: 'completed' });
      } else {
        updatePlan(planId, { status: 'failed', errorMessage: String(res?.message || t('skillPlan.runFailed')) });
      }
    } finally {
      setRunningPlanId(null);
    }
  };

  return (
    <div
      className={cn(
        'rounded-lg border border-slate-200/60 dark:border-slate-800/50',
        'bg-white/80 dark:bg-slate-950/30',
        'overflow-hidden',
        floating && 'fixed bottom-4 left-4 w-[420px] max-h-[80vh] shadow-lg z-50',
        className
      )}
    >
      <div className="px-4 py-3 border-b border-slate-200/60 dark:border-slate-800/50 bg-slate-50/60 dark:bg-slate-900/20">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ListChecks className="w-5 h-5 text-slate-700 dark:text-slate-300" />
            <h3 className="font-semibold text-slate-800 dark:text-slate-200">{t('skillPlan.title')}</h3>
            <span className="px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
              {plans.length}
            </span>
          </div>
          {hasMore ? (
            <span className="text-[11px] text-slate-500 dark:text-slate-400">{t('skillPlan.recentLimit').replace('{count}', String(maxItems))}</span>
          ) : null}
        </div>
        <p className="mt-1 text-[12px] text-slate-600 dark:text-slate-400">
          {t('skillPlan.description')}
        </p>
      </div>

      <div className="p-3 space-y-2 max-h-96 overflow-y-auto">
        {displayPlans.map((p) => {
          const stepCount = p.steps.length;
          const moreSteps = stepCount - 6;
          const expanded = expandedId === p.id;
          const isRunning = runningPlanId === p.id || p.status === 'running';
          const canRun = !isRunning && (p.status === 'awaiting_approval' || p.status === 'failed');
          const Icon = p.status === 'completed' ? CheckCircle2 : p.status === 'failed' ? XCircle : null;

          return (
            <div
              key={p.id}
              className="rounded-lg border border-slate-200/60 dark:border-slate-800/50 bg-white/70 dark:bg-slate-900/10 overflow-hidden"
            >
              <div
                className="px-3 py-2.5 flex items-center gap-2 cursor-pointer"
                onClick={() => setExpandedId(expanded ? null : p.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                      {p.skillId}
                    </span>
                    <StatusBadge status={p.status} locale={locale} />
                    {Icon ? <Icon className="w-4 h-4" /> : null}
                  </div>
                  <div className="text-[12px] text-slate-600 dark:text-slate-400 truncate">
                    {p.goal}
                  </div>
                </div>

                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t(stepCount === 1 ? 'skillPlan.stepCount.one' : 'skillPlan.stepCount.other').replace('{count}', String(stepCount))}
                </span>

                {expanded ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </div>

              {expanded ? (
                <div className="px-3 pb-3 space-y-2">
                  {p.errorMessage ? (
                    <div className="text-[12px] text-red-700 dark:text-red-300 bg-red-50/60 dark:bg-red-950/20 border border-red-200/60 dark:border-red-900/40 rounded-md p-2">
                      {p.errorMessage}
                    </div>
                  ) : null}

                  <div className="text-[12px] text-slate-600 dark:text-slate-400">
                    {t('skillPlan.createdAt').replace('{date}', new Date(p.createdAt).toLocaleString(getHtmlLang(locale)))}
                  </div>

                  <div className="rounded-md border border-slate-200/60 dark:border-slate-800/50 bg-slate-50/50 dark:bg-slate-950/20 p-2">
                    <div className="text-[12px] font-semibold text-slate-800 dark:text-slate-200 mb-1">{t('skillPlan.stepPreview')}</div>
                    <ul className="text-[12px] text-slate-700 dark:text-slate-300 space-y-1">
                      {p.steps.slice(0, 6).map((s, idx) => (
                        <li key={s.id} className="flex items-center justify-between gap-2">
                          <span className="truncate">
                            {idx + 1}. <span className="font-mono">{s.type}</span> · {s.name}
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            {getRiskLevelInfo(s.riskLevel || 'medium', locale)?.label ?? s.riskLevel}
                          </span>
                        </li>
                      ))}
                      {moreSteps > 0 ? (
                        <li className="text-[11px] text-slate-500 dark:text-slate-400">{t(moreSteps === 1 ? 'skillPlan.moreSteps.one' : 'skillPlan.moreSteps.other').replace('{count}', String(moreSteps))}</li>
                      ) : null}
                    </ul>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      onClick={() => removePlan(p.id)}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
                      title={t('skillPlan.deletePlan')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {t('common.delete')}
                    </button>

                    <button
                      onClick={() => void handleRun(p.id)}
                      disabled={!canRun}
                      className={cn(
                        'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors',
                        canRun
                          ? 'bg-blue-600 hover:bg-blue-700 text-white'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-500 cursor-not-allowed'
                      )}
                      title={t('skillPlan.runPlan')}
                    >
                      {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                      {t('skillAction.run')}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FloatingSkillExecutionPlanPanel() {
  return <SkillExecutionPlanPanel floating={true} />;
}

