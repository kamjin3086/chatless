'use client';

import { SidebarNavButton } from '@/components/ui/SidebarNavButton';
import { Wrench, Plug2 } from "lucide-react";
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

export function Sidebar() {
  const [showDevTools, setShowDevTools] = useState(false);
  const { t } = useLocaleStore();
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
  }, [showDevTools, t]);
  
  return (
    <div
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
    </div>
  );
} 