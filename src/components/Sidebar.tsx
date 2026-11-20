'use client';

import { SidebarNavButton } from '@/components/ui/SidebarNavButton';
import { Check, ChevronDown, PanelLeftClose, PanelLeftOpen, Wrench, Plug2 } from 'lucide-react';
import Link from 'next/link';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useUiPreferences } from '@/store/uiPreferences';
import { 
  ChatIcon, 
  DatabaseIcon, 
  AnalyticsIcon, 
  SettingsIcon,
  BookmarkIcon,
} from '@/components/icons/SidebarIcons';
import { shouldShowDevTools } from '@/lib/utils/environment';
import { useEffect, useState, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { DockHoverScaler } from '@/components/ui/DockHoverScaler';
import { useLocaleStore } from '@/store/localeStore';

const ExtensionsIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <Plug2 {...props} />
);

function useAppNavigation() {
  const [showDevTools, setShowDevTools] = useState(false);
  const { locale, t } = useLocaleStore();
  const pathname = usePathname();

  useEffect(() => {
    setShowDevTools(shouldShowDevTools());
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle(
      'page-paper',
      Boolean(pathname?.startsWith('/settings')),
    );
  }, [pathname]);
  
  const navItems = useMemo(() => {
    const base = [
      { href: '/chat', label: t('nav.chat'), icon: ChatIcon },
      { href: '/prompts', label: t('nav.prompts'), icon: BookmarkIcon },
      { href: '/knowledge', label: t('nav.knowledge'), icon: DatabaseIcon },
      { href: '/extensions', label: t('nav.extensions'), icon: ExtensionsIcon },
      { href: '/analytics', label: t('nav.analytics'), icon: AnalyticsIcon },
      { href: '/settings', label: t('nav.settings'), icon: SettingsIcon },
    ];
    return showDevTools
      ? [...base, { href: '/dev-tools', label: t('nav.devTools'), icon: Wrench }]
      : base;
  }, [showDevTools, t, locale]);
  const active = navItems.find(({ href }) => pathname === href || pathname?.startsWith(`${href}/`)) ?? navItems[0];
  return { navItems, active, t };
}

export function Sidebar() {
  const { navItems, t } = useAppNavigation();
  const initialized = useUiPreferences((state) => state.initialized);
  const setCollapsed = useUiPreferences((state) => state.setAppNavCollapsed);
  return (
    <nav aria-label={t('nav.switchPage')}
      className="glass-nav fixed top-0 h-[calc(100vh-1rem)] bg-white/95 dark:bg-slate-900/90 flex flex-col items-center pt-2 pb-2 z-50"
      style={{ width: 'var(--sidebar-width, 5rem)' }}
    >
      <DockHoverScaler
        orientation="vertical"
        maxScale={1.2}
        influenceRadius={80}
        transitionMs={90}
        className="flex-1 flex flex-col items-center gap-1 overflow-y-auto py-1.5 no-scrollbar"
        itemClassName="block py-1"
        itemTag="div"
      >
        {navItems.map((item) => (
          <SidebarNavButton
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            dev={item.href === '/dev-tools'}
          />
        ))}
      </DockHoverScaler>
      <button
        type="button"
        aria-label={t('nav.collapse')}
        title={t('nav.collapse')}
        disabled={!initialized}
        onClick={() => setCollapsed(true)}
        className="mb-1 grid size-8 shrink-0 place-items-center rounded-md text-slate-600 hover:bg-slate-500/10 focus-visible:outline-2 focus-visible:outline-sky-600 disabled:opacity-50 dark:text-slate-300 dark:focus-visible:outline-sky-400"
      >
        <PanelLeftClose aria-hidden="true" className="size-4" />
      </button>
    </nav>
  );
}

export function AppPageSwitcher() {
  const { navItems, active, t } = useAppNavigation();
  const setCollapsed = useUiPreferences((state) => state.setAppNavCollapsed);
  const ActiveIcon = active.icon;
  return (
    <nav aria-label={t('nav.switchPage')} data-app-page-switcher className="flex min-w-0 items-center">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={`${t('nav.switchPage')} · ${active.label}`}
            className="flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-md px-2 text-sm font-medium text-slate-800 hover:bg-slate-500/10 focus-visible:outline-2 focus-visible:outline-sky-600 data-[state=open]:bg-slate-500/10 dark:text-slate-100 dark:focus-visible:outline-sky-400">
            <ActiveIcon aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">{active.label}</span>
            <ChevronDown aria-hidden="true" className="size-3 shrink-0 text-slate-600 dark:text-slate-300" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6} data-app-page-menu className="z-[100] min-w-48 dark:bg-slate-900">
          {navItems.map(({ href, label, icon: Icon }) => (
            <DropdownMenuItem asChild key={href}>
              <Link href={href} aria-current={active.href === href ? 'page' : undefined}>
                <Icon aria-hidden="true" />
                <span className="flex-1">{label}</span>
                {active.href === href && <Check aria-hidden="true" className="size-4" />}
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCollapsed(false)}>
            <PanelLeftOpen aria-hidden="true" />
            {t('nav.expand')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
} 