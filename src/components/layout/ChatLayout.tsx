"use client";

import { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue } from 'react';
import StorageUtil from '@/lib/storage';
import { useUiPreferences } from '@/store/uiPreferences';
import { cn } from "@/lib/utils";
import {  X, Clock, Star, Flag, RotateCcw, ListPlus } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
// import { SidebarHeader } from './SidebarHeader';
import { ConversationSidebar } from "@/components/chat/ConversationSidebar";
import { useChatStore } from "@/store/chatStore";
import { Message, Conversation } from "@/types/chat";
import { SidebarContext } from "@/contexts/SidebarContext";
import { SearchInput } from '@/components/ui/search-input';
import { FloatingSkillApprovalPanel } from '@/components/skills/SkillApprovalPanel';

interface ChatLayoutProps {
  children: React.ReactNode;
}

export function ChatLayout({ children }: ChatLayoutProps) {
  const collapseChatSidebar = useUiPreferences((s) => s.collapseChatSidebar);
  const setCollapseChatSidebar = useUiPreferences((s) => s.setCollapseChatSidebar);
  const [isSidebarOpen, setIsSidebarOpen] = useState(!collapseChatSidebar);
  // 侧边栏默认宽度 280px，提供更好的内容显示空间
  const DEFAULT_SIDEBAR_WIDTH = 280;
  // 首屏消除闪烁：优先使用 localStorage 中的同步宽度作为初始值
  const getInitialSidebarPx = () => {
    try {
      if (typeof window !== 'undefined') {
        const raw = window.localStorage.getItem('ui_chat_sidebar_px');
        const px = raw ? parseInt(raw, 10) : NaN;
        if (!Number.isNaN(px)) return px;
      }
    } catch { /* noop */ }
    return DEFAULT_SIDEBAR_WIDTH;
  };
  const [sidebarWidth, setSidebarWidth] = useState<number>(getInitialSidebarPx());
  const sidebarWidthRef = useRef(sidebarWidth);
  const resetBtnRef = useRef<HTMLButtonElement | null>(null);
  const SIDEBAR_PX_KEY = 'ui_chat_sidebar_px';
  const MIN_SIDEBAR_WIDTH = 240; // 最小宽度
  // 动态最大宽度：根据窗口宽度自适应
  const getMaxSidebarWidth = () => {
    if (typeof window === 'undefined') return 600;
    const windowWidth = window.innerWidth;
    // 侧边栏最多占用窗口宽度的 35%，且不超过 600px，不少于 480px
    return Math.min(600, Math.max(480, Math.floor(windowWidth * 0.35)));
  };
  const [mounted, setMounted] = useState(false);

  // 监听窗口大小变化，动态调整最大宽度
  useEffect(() => {
    const handleResize = () => {
      const newMaxWidth = getMaxSidebarWidth();
      // 如果当前宽度超过新的最大宽度，自动调整
      if (sidebarWidthRef.current > newMaxWidth) {
        const adjustedWidth = Math.min(newMaxWidth, sidebarWidthRef.current);
        setSidebarWidth(adjustedWidth);
        sidebarWidthRef.current = adjustedWidth;
        StorageUtil.setItem<number>(SIDEBAR_PX_KEY, adjustedWidth, 'user-preferences.json');
        try { window.localStorage.setItem(SIDEBAR_PX_KEY, String(adjustedWidth)); } catch { /* noop */ }
      }
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 组件挂载时读取（异步）Tauri Store，完成后标记 mounted 以启用过渡动画
  useEffect(() => {
    (async () => {
      const saved = await StorageUtil.getItem<number>(SIDEBAR_PX_KEY, getInitialSidebarPx(), 'user-preferences.json');
      const currentMaxWidth = getMaxSidebarWidth();
      if (typeof saved === 'number' && saved >= MIN_SIDEBAR_WIDTH && saved <= currentMaxWidth) {
        if (saved !== sidebarWidthRef.current) {
          setSidebarWidth(saved);
          sidebarWidthRef.current = saved;
          try { window.localStorage.setItem(SIDEBAR_PX_KEY, String(saved)); } catch { /* noop */ }
        }
      }
      setMounted(true);
    })();
  }, []);

  // 同步 ref
  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  const [isDragging, setIsDragging] = useState(false);
  // 拖拽开始位置
  const dragInfo = useRef<{ startX: number; startWidth: number } | null>(null);
  // 记录拖拽开始前 body 的 userSelect 值，方便恢复
  const prevUserSelect = useRef<string | null>(null);

  /**
   * 拖拽侧边栏宽度
   */
  const handleDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    // 如果侧边栏已折叠，不允许拖拽
    if (!isSidebarOpen) return;
    // 阻止默认选区行为
    e.preventDefault();

    dragInfo.current = { startX: e.clientX, startWidth: sidebarWidth };

    // 禁用页面文字选中，避免出现蓝色选区（双保险：内联样式 + Tailwind class）
    prevUserSelect.current = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    document.body.classList.add('select-none');
    setIsDragging(true);

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragInfo.current) return;
      const delta = ev.clientX - dragInfo.current.startX;
      let newWidth = dragInfo.current.startWidth + delta;
      const currentMaxWidth = getMaxSidebarWidth();
      newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(newWidth, currentMaxWidth, window.innerWidth - 400));
      setSidebarWidth(newWidth);
      sidebarWidthRef.current = newWidth;
    };

    const handleMouseUp = (ev: MouseEvent) => {
      dragInfo.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      // 判断松开位置是否在重置按钮上（仅拖拽状态显示时）
      if (resetBtnRef.current) {
        const rect = resetBtnRef.current.getBoundingClientRect();
        if (
          ev.clientX >= rect.left &&
          ev.clientX <= rect.right &&
          ev.clientY >= rect.top &&
          ev.clientY <= rect.bottom
        ) {
          handleResetWidth();
        } else {
          // 拖拽结束后保存当前宽度
          StorageUtil.setItem<number>(SIDEBAR_PX_KEY, sidebarWidthRef.current, 'user-preferences.json');
          try { window.localStorage.setItem(SIDEBAR_PX_KEY, String(sidebarWidthRef.current)); } catch { /* noop */ }
        }
      } else {
        StorageUtil.setItem<number>(SIDEBAR_PX_KEY, sidebarWidthRef.current, 'user-preferences.json');
        try { window.localStorage.setItem(SIDEBAR_PX_KEY, String(sidebarWidthRef.current)); } catch { /* noop */ }
      }

      // 恢复 userSelect
      if (prevUserSelect.current !== null) {
        document.body.style.userSelect = prevUserSelect.current;
        prevUserSelect.current = null;
      }
      document.body.classList.remove('select-none');
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };
  const [searchQuery, setSearchQuery] = useState('');
  const deferredQuery = useDeferredValue(searchQuery);
  const [isSearching, setIsSearching] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'recent' | 'favorite' | 'important'>('recent');
  
  const createConversation = useChatStore((state) => state.createConversation);
  const conversations = useChatStore((state) => state.conversations);
  
  const toggleSidebar = () => {
    const nextOpen = !isSidebarOpen;
    setIsSidebarOpen(nextOpen);
  };

  // 同步 collapseChatSidebar 状态
  useEffect(() => {
    setCollapseChatSidebar(!isSidebarOpen);
  }, [isSidebarOpen, setCollapseChatSidebar]);
  
  // 处理搜索输入变化
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    setIsSearching(query.length > 0);
  }, []);
  
  // 清除搜索
  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    setIsSearching(false);
  }, []);

  // 处理分类筛选
  const handleFilterChange = (filter: 'recent' | 'favorite' | 'important') => {
    setActiveFilter(filter);
    // 如果在搜索模式，清除搜索
    if (isSearching) {
      handleClearSearch();
    }
  };

  // 过滤会话根据搜索关键词和分类筛选
  const filteredConversations = useMemo(() => {
    let result = conversations;
    
    // 首先应用分类筛选
    if (!isSearching) {
      switch (activeFilter) {
        case 'favorite':
          result = conversations.filter((conv: Conversation) => (conv as any)['is_favorite']);
          break;
        case 'important':
          result = conversations.filter((conv: Conversation) => (conv as any)['is_important']);
          break;
        case 'recent':
        default:
          result = conversations; // 显示所有会话，已经按更新时间排序
          break;
      }
    }
    
    // 如果在搜索模式，应用搜索筛选
    if (isSearching) {
      const normalizedQuery = deferredQuery.toLowerCase().trim();
      
      result = result.filter((conv: Conversation) => {
        // 搜索会话标题
        if (conv.title.toLowerCase().includes(normalizedQuery)) return true;
        
        // 搜索消息内容（安全检查messages是否存在）
        if (conv.messages && conv.messages.length > 0) {
          return conv.messages.some((message: Message) => 
            message.content.toLowerCase().includes(normalizedQuery)
          );
        }
        
        return false;
      });
    }
    
    return result;
  }, [conversations, deferredQuery, isSearching, activeFilter]);

  const handleNewChat = async () => {
    const defaultModelId = "default-model";
    const now = new Date();
    const newTitle = `新对话 ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute:'2-digit' })}`;
    await createConversation(newTitle, defaultModelId);
    
    // 创建新对话后清除搜索
    if (isSearching) {
      handleClearSearch();
    }
  };

  const handleResetWidth = useCallback(() => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    sidebarWidthRef.current = DEFAULT_SIDEBAR_WIDTH;
    StorageUtil.setItem<number>(SIDEBAR_PX_KEY, DEFAULT_SIDEBAR_WIDTH, 'user-preferences.json');
    try { window.localStorage.setItem(SIDEBAR_PX_KEY, String(DEFAULT_SIDEBAR_WIDTH)); } catch { /* noop */ }
  }, []);

  return (
    <SidebarContext.Provider value={{ isSidebarOpen, toggleSidebar }}>
      <div className="flex min-h-0 h-full relative">
        {/* 左侧会话列表侧边栏 */}
        <aside
          style={{ width: isSidebarOpen ? sidebarWidth : 0 }}
          className={cn(
            "bg-white dark:bg-gray-900 flex flex-col min-h-0 flex-shrink-0",
            mounted ? "transition-all duration-300" : "transition-none",
            isSidebarOpen
              ? "border-r border-slate-200/50 dark:border-slate-800/50 translate-x-0"
              : "-translate-x-full overflow-hidden"
          )}
        >
          {/* 侧边栏头部已隐藏 */}

          {/* 搜索框 + 新建按钮 - 紧凑风格 */}
          <div className="flex-shrink-0 px-2 py-1.5 border-b border-slate-200/40 dark:border-slate-700/40 bg-white/90 dark:bg-slate-900/90">
            <div className="flex items-center gap-1.5">
              <div className="flex-1 min-w-0">
                <div className="relative bg-slate-100/60 dark:bg-slate-800/40 rounded px-2 py-1 focus-within:bg-slate-100 dark:focus-within:bg-slate-800/60 transition-colors">
                  <SearchInput
                    placeholder="搜索对话..."
                    value={searchQuery}
                    onChange={handleSearchChange}
                    className="w-full bg-transparent border-none focus:ring-0 text-xs h-5 placeholder:text-slate-400/70"
                  />
                  {isSearching && (
                    <button
                      onClick={handleClearSearch}
                      className="absolute top-1/2 -translate-y-1/2 right-1 p-0.5 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 rounded transition-colors"
                      aria-label="清除"
                    >
                      <X className="w-3 h-3 text-slate-400" />
                    </button>
                  )}
                </div>
              </div>
              <IconButton
                onClick={handleNewChat}
                title="新建"
                icon={ListPlus}
                className="h-6 w-6 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              />
            </div>
          </div>

          {/* 对话分类标签 - 紧凑文字风格 */}
          {!isSearching && (
            <div className="flex-shrink-0 px-2 py-1 border-b border-slate-200/40 dark:border-slate-700/40 bg-white/90 dark:bg-slate-900/90">
              <div className="flex items-center gap-0.5 text-[11px]">
                <button 
                  className={cn(
                    "px-2 py-1 rounded transition-colors flex items-center gap-1",
                    activeFilter === 'recent' 
                      ? "text-blue-600 dark:text-blue-400 bg-blue-50/60 dark:bg-blue-900/20" 
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                  )} 
                  onClick={() => handleFilterChange('recent')}
                >
                  <Clock className="w-3 h-3" />
                  <span>最近</span>
                </button>
                <button 
                  className={cn(
                    "px-2 py-1 rounded transition-colors flex items-center gap-1",
                    activeFilter === 'favorite' 
                      ? "text-yellow-600 dark:text-yellow-400 bg-yellow-50/60 dark:bg-yellow-900/20" 
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                  )} 
                  onClick={() => handleFilterChange('favorite')}
                >
                  <Star className={cn("w-3 h-3", activeFilter === 'favorite' && "fill-current")} />
                  <span>收藏</span>
                </button>
                <button 
                  className={cn(
                    "px-2 py-1 rounded transition-colors flex items-center gap-1",
                    activeFilter === 'important' 
                      ? "text-red-600 dark:text-red-400 bg-red-50/60 dark:bg-red-900/20" 
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                  )} 
                  onClick={() => handleFilterChange('important')}
                >
                  <Flag className="w-3 h-3" />
                  <span>重要</span>
                </button>
              </div>
            </div>
          )}

          {/* 会话列表 - 传递过滤后的会话 */}
          <div className="flex-1 min-h-0 overflow-hidden bg-white dark:bg-gray-900">
            <ConversationSidebar 
              filteredConversations={filteredConversations}
              isSearching={isSearching}
              searchQuery={searchQuery}
            />
          </div>
        </aside>

        {/* 拖拽分隔条 */}
        {isSidebarOpen && (
          <div
            onMouseDown={handleDragStart}
            className={cn(
              "relative w-1 cursor-col-resize group transition-colors duration-150",
              isDragging ? "bg-blue-500/20" : "dark:bg-slate-900 bg-transparent hover:bg-blue-500/10"
            )}
          >
            {/* 重置按钮，仅在拖拽时显示 */}
            {isDragging && (
              <button
                ref={resetBtnRef}
                title="恢复默认宽度"
                className="absolute -right-3 top-1/2 -translate-y-1/2 p-1 rounded-full bg-white dark:bg-slate-800 shadow-md hover:bg-blue-500 hover:text-white transition-colors pointer-events-none"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {/* 主内容区域 */}
        <main className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-slate-900">
          {/* 聊天内容区域 - 使用flex-1和min-h-0确保正确滚动 */}
          <div className="flex-1 min-h-0 overflow-auto">
            {children}
          </div>
        </main>

        {/* 全局审批浮层：用于 Skills/Sandbox 高风险动作的 Human-in-the-loop 确认 */}
        <FloatingSkillApprovalPanel />
      </div>
    </SidebarContext.Provider>
  );
} 