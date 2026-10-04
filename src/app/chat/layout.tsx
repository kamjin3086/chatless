"use client"; // ChatLayout itself uses client hooks

import dynamic from 'next/dynamic';

// 使用动态导入，禁用SSR
const ChatLayoutClient = dynamic<{ children: React.ReactNode }>(
  () => import('../../components/chat/ChatLayoutClient'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full bg-slate-50 dark:bg-slate-950">
        {/* 聊天界面加载占位符 */}
        <div className="flex-1 py-6 px-8">
          <div className="h-12 w-64 bg-slate-200 dark:bg-slate-700 rounded-md animate-pulse mb-6"></div>
          <div className="space-y-4 w-full">
            <div className="h-16 w-full bg-slate-200 dark:bg-slate-700 rounded-md animate-pulse"></div>
            <div className="h-16 w-full bg-slate-200 dark:bg-slate-700 rounded-md animate-pulse"></div>
            <div className="h-16 w-full bg-slate-200 dark:bg-slate-700 rounded-md animate-pulse"></div>
          </div>
        </div>
      </div>
    )
  }
);

export default function LayoutForChat({ 
  children 
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full">
      <ChatLayoutClient>{children}</ChatLayoutClient>
    </div>
  );
} 