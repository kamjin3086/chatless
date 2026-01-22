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
  status: SkillStatus;
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
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  },
  needs_update: {
    label: '有更新',
    icon: AlertCircle,
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  },
  missing_deps: {
    label: '缺少依赖',
    icon: AlertTriangle,
    className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  },
  not_installed: {
    label: '未安装',
    icon: Download,
    className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  },
  error: {
    label: '错误',
    icon: XCircle,
    className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  },
};

export function SkillStatusBadge({
  status,
  className,
  showIcon = true,
  showText = true,
}: SkillStatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        config.className,
        className
      )}
    >
      {showIcon && <Icon className="h-3 w-3" />}
      {showText && <span>{config.label}</span>}
    </span>
  );
}

