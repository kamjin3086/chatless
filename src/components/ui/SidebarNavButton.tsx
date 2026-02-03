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
              'nav-item flex flex-col items-center justify-center h-8 w-8 rounded-md transition-colors duration-150 relative group cursor-pointer',
              isActive
                ? 'bg-slate-100/80 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200'
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 hover:text-slate-600 dark:hover:text-slate-300',
              dev && 'border border-orange-400/30 dark:border-orange-500/30'
            )}
            aria-label={label}
          >
            <Icon
              style={{ width: 'var(--sidebar-icon-size, 0.95rem)', height: 'var(--sidebar-icon-size, 0.95rem)' }}
              className={cn('transition-colors', dev && 'text-orange-500 dark:text-orange-400')}
            />
          </Link>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          sideOffset={8}
          className="px-2 py-1 text-xs rounded bg-gray-900 dark:bg-gray-100 text-gray-100 dark:text-gray-900"
        >
          {label}
          {dev && <span className="ml-1 text-orange-500">(开发)</span>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
} 