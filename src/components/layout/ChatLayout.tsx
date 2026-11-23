"use client";

import { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue } from 'react';
import StorageUtil from '@/lib/storage';
import { useUiPreferences } from '@/store/uiPreferences';
import { cn } from "@/lib/utils";
import { X, Archive, Clock, FolderPlus, Star, RotateCcw, Plus } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
// import { SidebarHeader } from './SidebarHeader';
import { ConversationSidebar } from "@/components/chat/ConversationSidebar";
import { ConversationViewMenu } from '@/components/chat/ConversationViewMenu';
import { useConversationAttachmentStore } from '@/store/conversationAttachmentStore';
import { useTranslation } from '@/i18n/useTranslation';
import { workspaceGroupName, workspacePath } from '@/lib/chat/conversationGroups';
import { NEW_CONVERSATION_TITLE } from '@/lib/chat/TitleGenerator';
import { toast } from '@/components/ui/sonner';
import { useChatStore } from "@/store/chatStore";
import { afterStartupPaint, startupMonitor } from '@/lib/utils/startupPerformanceMonitor';
import { Message, Conversation } from "@/types/chat";
import { SidebarContext } from "@/contexts/SidebarContext";
import { SearchInput } from '@/components/ui/search-input';
import { FloatingSkillApprovalPanel } from '@/components/skills/SkillApprovalPanel';
import { RouteErrorBoundary } from '@/components/errors/RouteErrorBoundary';

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
  const [activeFilter, setActiveFilter] = useState<'recent' | 'favorite' | 'archived'>('recent');
  const [openingWorkspace, setOpeningWorkspace] = useState(false);
  const pendingWorkspace = useChatStore((state) => state.pendingWorkspace);
  const setGrouping = useUiPreferences((state) => state.setConversationGrouping);
  const directories = useConversationAttachmentStore((state) => state.mountedDirByConversation);
  const archivedWorkspaces = useConversationAttachmentStore((state) => state.archivedWorkspaces);
  const archivedTarget = pendingWorkspace && archivedWorkspaces[pendingWorkspace.path];
  const archivedConversations = useConversationAttachmentStore((state) => state.archivedConversations);
  const t = useTranslation();
  
  const createConversation = useChatStore((state) => state.createConversation);
  const conversations = useChatStore((state) => state.conversations);
  const hasLoadedConversations = useChatStore((state) => state.hasLoadedConversations);

  useEffect(() => {
    if (!hasLoadedConversations || !isSidebarOpen) return;
    return afterStartupPaint(() => startupMonitor.markChatReady('historyVisible'));
  }, [hasLoadedConversations, isSidebarOpen]);
  const currentConversationId = useChatStore(
    (state) => state.currentConversationId,
  );
  
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
  const handleFilterChange = (filter: 'recent' | 'favorite' | 'archived') => {
    setActiveFilter(filter);
    // 如果在搜索模式，清除搜索
    if (isSearching) {
      handleClearSearch();
    }
  };

  // 过滤会话根据搜索关键词和分类筛选
  const filteredConversations = useMemo(() => {
    let result = conversations.filter((conversation) => {
      const path = workspacePath(directories[conversation.id]);
      const archived = Boolean(archivedConversations[conversation.id] || (path && archivedWorkspaces[path]));
      return archived === (activeFilter === 'archived');
    });
    
    // 首先应用分类筛选
    if (!isSearching) {
      switch (activeFilter) {
        case 'favorite':
          result = result.filter((conv) => conv.is_favorite);
          break;
        case 'recent':
        default:
          // The archive filter is already applied.
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
  }, [conversations, deferredQuery, isSearching, activeFilter, directories, archivedWorkspaces, archivedConversations]);

  const handleNewChat = async (path?: string | null) => {
    const defaultModelId = "default-model";
    try {
      await createConversation(NEW_CONVERSATION_TITLE, defaultModelId, undefined, path);
      if (activeFilter !== 'recent') setActiveFilter('recent');
    } catch {
      toast.error(t('chatSidebar.newConversationFailed'));
      return;
    }
    
    // 创建新对话后清除搜索
    if (isSearching) {
      handleClearSearch();
    }
  };

  const handleOpenWorkspace = async () => {
    setOpeningWorkspace(true);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false, title: t('chatSidebar.openWorkspace') });
      const path = typeof selected === 'string' ? workspacePath(selected) : null;
      if (!path) return;
      const store = useConversationAttachmentStore.getState();
      store.registerWorkspace(path);
      setGrouping('workspace');
      setActiveFilter(store.archivedWorkspaces[path] ? 'archived' : 'recent');
      handleClearSearch();
      useChatStore.getState().selectWorkspaceForNewConversation(path);
    } catch {
      toast.error(t('chatSidebar.openWorkspaceFailed'));
    } finally {
      setOpeningWorkspace(false);
    }
  };

  const handleResetWidth = useCallback(() => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    sidebarWidthRef.current = DEFAULT_SIDEBAR_WIDTH;
    StorageUtil.setItem<number>(SIDEBAR_PX_KEY, DEFAULT_SIDEBAR_WIDTH, 'user-preferences.json');
    try { window.localStorage.setItem(SIDEBAR_PX_KEY, String(DEFAULT_SIDEBAR_WIDTH)); } catch { /* noop */ }
  }, []);

  return (
    <SidebarContext.Provider value={{ isSidebarOpen, toggleSidebar, newConversation: handleNewChat }}>
      <div className="flex min-h-0 h-full relative">
        {/* 左侧会话列表侧边栏 */}
        <aside
          style={{ width: isSidebarOpen ? sidebarWidth : 0 }}
          className={cn(
            "chat-rail bg-white dark:bg-slate-900 flex flex-col min-h-0 flex-shrink-0 glass-surface",
            mounted ? "transition-all duration-300" : "transition-none",
            isSidebarOpen
              ? "border-r border-slate-200/50 dark:border-slate-800/50 translate-x-0"
              : "-translate-x-full overflow-hidden"
          )}
        >
          {/* 侧边栏头部已隐藏 */}

          {/* Search and sidebar tools */}
          <div className="flex h-9 shrink-0 items-center px-2.5" data-chat-search-row>
            <div className="flex w-full min-w-0 items-center gap-1">
              <div className="relative flex-1 min-w-0">
                <SearchInput
                  placeholder={t('chatSidebar.search')}
                  aria-label={t('chatSidebar.search')}
                  value={searchQuery}
                  onChange={handleSearchChange}
                  className="h-8 w-full pr-6 text-sm placeholder:text-slate-600 dark:placeholder:text-slate-300"
                />
                {isSearching && (
                  <button
                    onClick={handleClearSearch}
                    className="absolute top-1/2 -translate-y-1/2 right-1 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    aria-label={t('common.clearSearch')}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <ConversationViewMenu
                archiveVisible={activeFilter === 'archived'}
                onArchiveVisibleChange={(visible) => handleFilterChange(visible ? 'archived' : 'recent')}
              />
              <IconButton
                onClick={handleOpenWorkspace}
                disabled={openingWorkspace}
                title={t('chatSidebar.openWorkspace')}
                icon={FolderPlus}
                className="h-7 w-7 shrink-0 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              />
            </div>
          </div>

          <div className="shrink-0 px-2.5 py-1.5">
            <button
              type="button"
              disabled={Boolean(archivedTarget)}
              title={archivedTarget ? t('chatSidebar.restoreWorkspace') : pendingWorkspace?.path}
              onClick={() => void handleNewChat()}
              className="flex min-h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-slate-500/20 bg-slate-500/8 px-2.5 text-left text-sm font-medium text-slate-900 hover:bg-slate-500/15 focus-visible:outline-2 focus-visible:outline-sky-600 disabled:opacity-50 dark:text-slate-100 dark:focus-visible:outline-sky-400"
            >
              <Plus aria-hidden="true" className="size-4 shrink-0" />
              <span className="shrink-0">{t('chatSidebar.newConversation')}</span>
              {pendingWorkspace && (
                <span className="ml-auto truncate text-xs text-slate-600 dark:text-slate-300">
                  {workspaceGroupName(pendingWorkspace.path)}
                </span>
              )}
            </button>
          </div>

          {/* 对话分类 */}
          {(!isSearching || activeFilter === 'archived') && (
            <div className="shrink-0 px-2 pt-1 pb-1">
              <div className="flex flex-wrap items-center gap-0.5 text-xs">
                {!isSearching && ([
                  ['recent', 'chatSidebar.recent', Clock],
                  ['favorite', 'chatSidebar.favorites', Star],
                ] as const).map(([filter, label, Icon]) => (
                  <button
                    key={filter}
                    type="button"
                    aria-pressed={activeFilter === filter}
                    onClick={() => handleFilterChange(filter)}
                    className={cn(
                      'flex min-h-7 items-center gap-1.5 rounded-md px-2 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-600 motion-reduce:transition-none dark:focus-visible:outline-sky-400',
                      activeFilter === filter
                        ? 'bg-sky-600/10 text-sky-800 dark:bg-sky-400/12 dark:text-sky-200'
                        : 'text-slate-700 hover:bg-slate-500/10 dark:text-slate-300',
                    )}
                  >
                    <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', filter === 'favorite' && activeFilter === filter && 'fill-current')} />
                    {t(label)}
                  </button>
                ))}
                {activeFilter === 'archived' && (
                  <button type="button" onClick={() => handleFilterChange('recent')}
                    title={t('chatSidebar.exitArchive')}
                    aria-label={t('chatSidebar.exitArchive')}
                    className="flex min-h-7 items-center gap-1.5 rounded-md bg-sky-600/10 px-2 font-medium text-sky-800 focus-visible:outline-2 focus-visible:outline-sky-600 dark:bg-sky-400/12 dark:text-sky-200 dark:focus-visible:outline-sky-400">
                    <Archive aria-hidden="true" className="size-3.5" />
                    {t('chatSidebar.archived')}
                    <X aria-hidden="true" className="size-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 会话列表 - 传递过滤后的会话 */}
          <div className="flex-1 min-h-0 overflow-hidden glass-surface">
            <ConversationSidebar 
              filteredConversations={filteredConversations}
              isSearching={isSearching}
              searchQuery={searchQuery}
              filter={activeFilter}
              onCreateInWorkspace={handleNewChat}
            />
          </div>
        </aside>

        {/* 拖拽分隔条 */}
        {isSidebarOpen && (
          <div
            onMouseDown={handleDragStart}
            className={cn(
              // No fill of its own: the handle is a drag target, and the rail already ends in a
              // divider. Painting it slate-900 left a 4px black slot between the rail and the
              // chat area on the glass sheet, which read as a gap, not as a boundary.
              "relative w-1 cursor-col-resize group transition-colors duration-150",
              isDragging ? "bg-slate-400/20" : "bg-transparent hover:bg-slate-400/10"
            )}
          >
            {/* 重置按钮，仅在拖拽时显示 */}
            {isDragging && (
              <button
                ref={resetBtnRef}
                title={t('chatSidebar.resetWidth')}
                className="absolute -right-3 top-1/2 -translate-y-1/2 p-1 rounded-full bg-white dark:bg-slate-800 shadow-md hover:bg-slate-600 hover:text-white transition-colors pointer-events-none"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {/* 主内容区域 */}
        <main className="flex-1 flex flex-col min-h-0 glass-surface">
          {/* 聊天内容区域 - 使用flex-1和min-h-0确保正确滚动 */}
          <div className="flex-1 min-h-0 overflow-auto">
            {/* Keep the conversation list outside this boundary: a chat-page failure
                must not replace the list that is the way back to another conversation. */}
            <RouteErrorBoundary resetKey={currentConversationId ?? ''}>
              {children}
            </RouteErrorBoundary>
          </div>
        </main>

        {/* 全局审批浮层：用于 Skills/Sandbox 高风险动作的 Human-in-the-loop 确认 */}
        <FloatingSkillApprovalPanel />
      </div>
    </SidebarContext.Provider>
  );
} 
