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
    className: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400',
  },
  needs_update: {
    label: '有更新',
    icon: AlertCircle,
    className: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400',
  },
  missing_deps: {
    label: '缺少依赖',
    icon: AlertTriangle,
    className: 'bg-orange-50 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400',
  },
  not_installed: {
    label: '未安装',
    icon: Download,
    className: 'bg-slate-50 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400',
  },
  error: {
    label: '错误',
    icon: XCircle,
    className: 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400',
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
        'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium',
        safeConfig.className,
        className
      )}
    >
      {showIcon && <Icon className="h-2.5 w-2.5" />}
      {showText && <span>{safeConfig.label}</span>}
    </span>
  );
}

