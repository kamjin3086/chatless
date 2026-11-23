'use client';

import type { TranslationKey } from '@/i18n/types';
import { cn } from '@/lib/utils';
import type { SkillStatus } from '@/lib/skills/types';
import { useLocaleStore } from '@/store/localeStore';
import { 
  CheckCircle, 
  AlertCircle, 
  Download, 
  AlertTriangle,
  XCircle 
} from 'lucide-react';

interface SkillStatusBadgeProps {
  status: SkillStatus | (string & {}) | undefined | null;
  className?: string;
  showIcon?: boolean;
  showText?: boolean;
}

const statusConfig: Record<SkillStatus, {
  labelKey: TranslationKey;
  icon: typeof CheckCircle;
  className: string;
}> = {
  installed: {
    labelKey: 'skills.status.installed',
    icon: CheckCircle,
    className: 'text-emerald-700 border border-emerald-200/70 bg-emerald-50/50 dark:text-emerald-400 dark:border-emerald-800/40 dark:bg-emerald-900/20',
  },
  needs_update: {
    labelKey: 'skills.status.needsUpdate',
    icon: AlertCircle,
    className: 'text-slate-600 border border-slate-200/70 bg-slate-100/50 dark:text-slate-300 dark:border-slate-600/50 dark:bg-slate-800/40',
  },
  missing_deps: {
    labelKey: 'skills.status.missingDeps',
    icon: AlertTriangle,
    className: 'text-slate-600 border border-slate-200/70 bg-slate-100/50 dark:text-slate-300 dark:border-slate-600/50 dark:bg-slate-800/40',
  },
  not_installed: {
    labelKey: 'skills.status.notInstalled',
    icon: Download,
    className: 'text-slate-500 border border-slate-200/60 bg-slate-50/50 dark:text-slate-400 dark:border-slate-600/50 dark:bg-slate-800/30',
  },
  error: {
    labelKey: 'skills.status.error',
    icon: XCircle,
    className: 'text-red-600 border border-red-200/70 bg-red-50/50 dark:text-red-400 dark:border-red-800/40 dark:bg-red-900/20',
  },
};

export function SkillStatusBadge({
  status,
  className,
  showIcon = true,
  showText = true,
}: SkillStatusBadgeProps) {
  const { t } = useLocaleStore();
  const code = typeof status === 'string' ? status : '';
  const config = Object.prototype.hasOwnProperty.call(statusConfig, code)
    ? statusConfig[code as SkillStatus]
    : undefined;
  const Icon = config?.icon ?? AlertCircle;
  const label = config
    ? t(config.labelKey)
    : !code || code === 'unknown'
      ? t('skills.status.unknown')
      : t('skills.status.unknownWithCode').replace('{0}', () => code);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium',
        config?.className ?? 'bg-slate-50 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400',
        className
      )}
    >
      {showIcon && <Icon className="h-2.5 w-2.5" />}
      {showText && <span>{label}</span>}
    </span>
  );
}

