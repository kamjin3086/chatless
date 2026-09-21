"use client";
import localFont from 'next/font/local';
import dynamic from 'next/dynamic';
import "@/styles/globals.css";
import FoldingLoader from '@/components/ui/FoldingLoader';
import { Toaster } from "@/components/ui/sonner";
import { CommandPalette } from "@/components/CommandPalette";
import '@/commands/defaultCommands';
import { useEffect, useRef } from "react";
import { useGlobalFontSize } from "@/hooks/useGlobalFontSize";
import { useUiPreferences } from "@/store/uiPreferences";
import { useLocaleStore } from "@/store/localeStore";
import { getHtmlLang } from "@/i18n";
import { listen } from '@tauri-apps/api/event';
import { useRouter } from "next/navigation";
import { preloadInitialLogos } from '@/lib/utils/logoPreloader';
import { WindowTitleBar } from '@/components/layout/WindowTitleBar';
import { isTauriEnvironment } from '@/lib/utils/environment';

// The custom title bar is a platform capability, not a user setting, so the
// class has to exist before the first paint (waiting for an effect makes the
// title bar jump).  Applying it while the client bundle is evaluated means
// <html> carries a class the server could not render; the root element below
// therefore opts out of hydration checking for its own attributes, which is
// what the class and the storage-driven locale need.
if (typeof window !== 'undefined' && isTauriEnvironment()) {
  document.documentElement.classList.add('custom-titlebar');
}

// 动态导入系统托盘管理器
const initializeTray = async () => {
  try {
    const { trayManager } = await import('@/lib/tray');
    await trayManager.initialize();
  } catch (error) {
    console.error('系统托盘初始化失败:', error);
  }
};

// 监听导航事件
const setupNavigationListener = async (router: any) => {
  try {
    await listen('navigate', (event) => {
      const target = event.payload as string;
      console.log('导航到:', target);
      
      // 根据目标页面进行导航
      switch (target) {
        case 'chat':
          router.push('/chat');
          break;
        case 'history':
          router.push('/history');
          break;
        case 'knowledge':
          router.push('/knowledge');
          break;
        case 'settings':
          router.push('/settings');
          break;
        default:
          console.log('未知的导航目标:', target);
      }
    });

    // 监听创建新聊天事件
    await listen('create-new-chat', async () => {
      console.log('创建新聊天会话');
      
      // 先导航到聊天页面
      router.push('/chat');
      
      // 等待页面加载完成后创建新会话
      setTimeout(async () => {
        try {
          // 动态导入聊天store
          const { useChatStore } = await import('@/store/chatStore');
          const { createConversation } = useChatStore.getState();
          
          // 创建新会话
          const newChatId = await createConversation('新对话', 'default');
          console.log('新聊天会话创建成功:', newChatId);
        } catch (error) {
          console.error('创建新聊天会话失败:', error);
        }
      }, 500); // 等待500ms确保页面加载完成
    });
  } catch (error) {
    console.error('设置导航监听器失败:', error);
  }
};

// 引入数据库锁定修复工具
import '@/lib/services/databaseLockFixer';

// 开发环境：导入数据库管理工具以便在控制台中使用
if (process.env.NODE_ENV === 'development') {
  setTimeout(() => {
  // 动态导入避免生产环境包含开发工具
  import("@/lib/__admin__/devTools").then((devTools) => {
    // 开发工具已加载
  }).catch(console.error);

  // 加载数据库诊断工具
  import('@/lib/__admin__/databaseDiagnostic').then(() => {
    // 数据库诊断工具已加载
  }).catch(console.error);

  // 加载文档同步服务
  import('@/lib/services/documentSync').then(() => {
    // 文档同步服务已加载
  }).catch(console.error);
  }, 1000); // 延迟1秒加载，让主界面先渲染
}

// 动态导入组件并指定正确的类型
const TauriApp = dynamic<{ children: React.ReactNode }>(
  () => import('../components/TauriApp'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full">
        <div className="w-16 bg-white border-r border-gray-200 h-screen flex-shrink-0">
          {/* 全局侧边栏占位符 */}
        </div>
        <div className="flex-1">
          <div className="flex h-full">
            <div className="w-64 bg-gray-50 border-r border-gray-200 flex-shrink-0 h-full">
              {/* 聊天侧边栏占位符 */}
            </div>
            <div className="flex-1 bg-gray-50 relative">
              {/* 聊天内容占位符 + 品牌加载动画 */}
              <div className="absolute inset-0 flex items-center justify-center">
                <FoldingLoader size={40} />
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }
);

const inter = localFont({
  src: [
    {
      path: '../../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  display: 'swap',
  variable: '--font-inter',
});

// Note: 由于这是客户端组件，metadata 导出会被忽略
// 页面级metadata应该在page.tsx中定义

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 调用 Hook 以确保全局字体大小类被挂载
  useGlobalFontSize();

  // 订阅 UI 偏好
  const { initialized, simpleMode, lowAnimationMode, sidebarWidth, sidebarIconSize } = useUiPreferences();
  const { locale, initialized: localeInitialized } = useLocaleStore();
  
  // 获取 Next.js 路由实例
  const router = useRouter();

  useEffect(() => {
    if (!localeInitialized) return;
    document.documentElement.lang = getHtmlLang(locale);
  }, [locale, localeInitialized]);

  useEffect(() => {
    if (!initialized) return;
    
    // 初始化系统托盘和导航监听器
    initializeTray();
    setupNavigationListener(router);
    // 提前预加载常见 Provider 与品牌 logo，提升全站首屏图标显示速度
    preloadInitialLogos().catch(()=>{});
    
    const html = document.documentElement;
    // 简洁模式
    if (simpleMode) {
      html.classList.add("simple-ui");
    } else {
      html.classList.remove("simple-ui");
    }

    // 低动画模式
    if (lowAnimationMode) {
      html.classList.add("reduced-motion");
    } else {
      html.classList.remove("reduced-motion");
    }

    // 侧边栏宽度（仅当值变化时才写入，避免样式闪烁）
    const widthMap: Record<string, string> = {
      narrow: "3.5rem", // 56px
      medium: "4.5rem", // 72px
      wide: "6rem",    // 96px
      xwide: "8rem",   // 128px
    };
    const targetWidth = widthMap[sidebarWidth] || "4.5rem";
    if (getComputedStyle(html).getPropertyValue('--sidebar-width').trim() !== targetWidth) {
      html.style.setProperty("--sidebar-width", targetWidth);
    }

    // icon size mapping
    const iconMap: Record<string, string> = {
      small: '1.125rem', //18
      medium: '1.25rem', //20
      large: '1.5rem',   //24
    };

    // @ts-ignore
    const iconSize = sidebarIconSize;
    const targetIcon = iconMap[iconSize] || '1.25rem';
    if (getComputedStyle(html).getPropertyValue('--sidebar-icon-size').trim() !== targetIcon) {
      html.style.setProperty('--sidebar-icon-size', targetIcon);
    }
  }, [initialized, simpleMode, lowAnimationMode, sidebarWidth, sidebarIconSize]);

  // suppressHydrationWarning: the client adds the title-bar class before
  // hydration and the locale store applies the saved language on load, so the
  // root element's attributes are intentionally client-first.
  return (
    <html lang={getHtmlLang(locale)} className="h-full" suppressHydrationWarning>
      <body className={`${inter.variable} h-full bg-background text-foreground antialiased`}>
        <WindowTitleBar />
        <TauriApp>
          {children}
        </TauriApp>
        <CommandPalette />
        <Toaster />
      </body>
    </html>
  );
}
