import { cn } from "@/lib/utils";

interface SettingsCardProps {
  children: React.ReactNode;
  className?: string;
  /** 是否添加内边距 */
  noPadding?: boolean;
}

/**
 * 统一的设置卡片容器
 * 采用紧凑的 slate 色系风格
 */
export function SettingsCard({ children, className, noPadding }: SettingsCardProps) {
  return (
    <div className={cn(
      "settings-card glass-panel rounded-lg border border-slate-200/60 dark:border-slate-700/40",
      "bg-white/40 dark:bg-slate-900/40",
      !noPadding && "p-4",
      "mb-4",
      className
    )}>
      {children}
    </div>
  );
}

/**
 * 设置页面的顶部描述区域
 */
interface SettingsPageHeaderProps {
  title: string;
  description: string;
}

export function SettingsPageHeader({ title, description }: SettingsPageHeaderProps) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-medium text-slate-800 dark:text-slate-100 mb-2">{title}</h2>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
        {description}
      </p>
    </div>
  );
}

/**
 * 设置分组标题
 */
interface SettingsGroupProps {
  title: string;
  icon?: React.ElementType;
  children: React.ReactNode;
  className?: string;
}

export function SettingsGroup({ title, icon: Icon, children, className }: SettingsGroupProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
        {Icon && <Icon className="w-4 h-4 text-slate-500" />}
        <h3 className="text-xs font-medium text-slate-700 dark:text-slate-300">{title}</h3>
      </div>
      <div className="space-y-2">
        {children}
      </div>
    </div>
  );
}
