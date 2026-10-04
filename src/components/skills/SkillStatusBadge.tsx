'use client';

import { cn } from '@/lib/utils';
import type { SkillStatus } from '@/lib/skills/types';
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
  label: string;
  icon: typeof CheckCircle;
  className: string;
}> = {
  installed: {
    label: '已安装',
    icon: CheckCircle,
    className: 'text-emerald-700 border border-emerald-200/70 bg-emerald-50/50 dark:text-emerald-400 dark:border-emerald-800/40 dark:bg-emerald-900/20',
  },
  needs_update: {
    label: '有更新',
    icon: AlertCircle,
    className: 'text-slate-600 border border-slate-200/70 bg-slate-100/50 dark:text-slate-300 dark:border-slate-600/50 dark:bg-slate-800/40',
  },
  missing_deps: {
    label: '缺少依赖',
    icon: AlertTriangle,
    className: 'text-slate-600 border border-slate-200/70 bg-slate-100/50 dark:text-slate-300 dark:border-slate-600/50 dark:bg-slate-800/40',
  },
  not_installed: {
    label: '未安装',
    icon: Download,
    className: 'text-slate-500 border border-slate-200/60 bg-slate-50/50 dark:text-slate-400 dark:border-slate-600/50 dark:bg-slate-800/30',
  },
  error: {
    label: '错误',
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
  const key = (status && typeof status === 'string') ? status : 'unknown';
  const config =
    (key in statusConfig ? (statusConfig as any)[key] : null) as
      | { label: string; icon: typeof CheckCircle; className: string }
      | null;

  const safeConfig = config ?? {
    label: key === 'unknown' ? '未知' : `未知（${key}）`,
    icon: AlertCircle,
    className: 'bg-slate-50 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400',
  };
  const Icon = safeConfig.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium',
        safeConfig.className,
        className
      )}
    >
      {showIcon && <Icon className="h-2.5 w-2.5" />}
      {showText && <span>{safeConfig.label}</span>}
    </span>
  );
}

