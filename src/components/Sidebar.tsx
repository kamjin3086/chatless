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

// 扩展图标组件 (技能+MCP)
const ExtensionsIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <Plug2 {...props} />
);
import { shouldShowDevTools } from '@/lib/utils/environment';
import { useEffect, useState } from 'react';
import { DockHoverScaler } from '@/components/ui/DockHoverScaler';

// 基础侧边栏导航项（精简后）
const baseNavItems = [
  { href: '/chat', label: '聊天', icon: ChatIcon },
  { href: '/prompts', label: '提示词', icon: BookmarkIcon },
  { href: '/knowledge', label: '知识', icon: DatabaseIcon },
  { href: '/extensions', label: '扩展', icon: ExtensionsIcon },
  { href: '/analytics', label: '统计', icon: AnalyticsIcon },
  { href: '/settings', label: '设置', icon: SettingsIcon },
];

// 开发工具导航项
const devNavItems = [
  { href: '/dev-tools', label: '开发工具', icon: Wrench },
];

export function Sidebar() {
  const [showDevTools, setShowDevTools] = useState(false);
  
  useEffect(() => {
    // 客户端检测是否显示开发工具
    setShowDevTools(shouldShowDevTools());
  }, []);
  
  // 合并导航项
  const navItems = showDevTools ? [...baseNavItems, ...devNavItems] : baseNavItems;
  
  return (
    <div
      className="fixed h-[calc(100vh-1rem)] bg-white/90 dark:bg-gray-900/90 flex flex-col items-center pt-2 pb-2 z-50"
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