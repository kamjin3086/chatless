import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface SidebarNavButtonProps {
  href: string;
  label: string;
  icon: LucideIcon | React.ComponentType<React.SVGProps<SVGSVGElement>>;
  /** 是否为开发工具，展示特殊边框/颜色 */
  dev?: boolean;
}

/**
 * 统一的侧边栏导航按钮。封装了激活态、hover 动效及 Tooltip。
 */
export function SidebarNavButton({ href, label, icon: Icon, dev }: SidebarNavButtonProps) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(href + '/');

  return (
    <TooltipProvider delayDuration={80}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={href}
            className={cn(
              'nav-item flex flex-col items-center justify-center h-8 w-8 rounded-md bg-transparent transition-colors duration-150 relative group cursor-pointer',
              isActive
                ? 'nav-item-active text-sky-700 dark:text-sky-300'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
              dev && 'nav-item-dev'
            )}
            aria-label={label}
          >
            <Icon
              style={{ width: 'var(--sidebar-icon-size, 0.95rem)', height: 'var(--sidebar-icon-size, 0.95rem)' }}
              className={cn('transition-colors', dev && 'nav-item-dev-icon text-orange-500 dark:text-orange-400')}
            />
          </Link>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          sideOffset={8}
          className="glass-float-tip glass-nav-tooltip px-2 py-1 text-xs rounded-md"
        >
          {label}
          {dev && <span className="ml-1 text-slate-300">(开发)</span>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
} 