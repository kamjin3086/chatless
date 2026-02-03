"use client";

import { cn } from "@/lib/utils";

interface SettingsSectionHeaderProps {
  icon?: React.ElementType;
  title: string;
  className?: string;
}

/**
 * 紧凑的设置区块标题
 * 图标统一使用 slate 色系，不带背景色
 */
export function SettingsSectionHeader({
  icon: Icon,
  title,
  className,
}: SettingsSectionHeaderProps) {
  return (
    <div className={cn("flex items-center gap-2 mb-3", className)}>
      {Icon && <Icon className="w-4 h-4 text-slate-400 dark:text-slate-500" />}
      <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">{title}</h3>
    </div>
  );
}
