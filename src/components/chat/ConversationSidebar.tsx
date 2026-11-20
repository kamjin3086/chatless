"use client";

import React, { useMemo, useState, useEffect, useRef } from "react";
import { Conversation } from "@/types/chat";
import { useChatStore } from "@/store/chatStore";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Virtuoso } from 'react-virtuoso';
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChevronRight, Folder, FolderOpen, SearchIcon, MessageSquare } from "lucide-react";
import { ContextMenu } from '@/components/ui/context-menu';
import { toast } from '@/components/ui/sonner';
import { FileOpener } from '@/lib/utils/fileOpener';
import { conversationSidebarRows, workspaceGroupName, workspaceGroupParent, workspacePath } from '@/lib/chat/conversationGroups';
import { useConversationAttachmentStore } from '@/store/conversationAttachmentStore';
import { useLocaleStore } from '@/store/localeStore';
import { useUiPreferences } from '@/store/uiPreferences';
import FoldingLoader from '@/components/ui/FoldingLoader';
import { ConversationItem } from "./ConversationItem";
import { DeleteConversationDialog } from "./DeleteConversationDialog";
import { exportConversationMarkdown } from '@/lib/chat/actions/download';

interface ConversationSidebarProps {
  filteredConversations?: Conversation[];
  isSearching?: boolean;
  searchQuery?: string;
  filter: 'recent' | 'favorite' | 'archived';
  openedPath: { path: string } | null;
  onCreateInWorkspace: (path: string | null) => Promise<void>;
}

export function ConversationSidebar({ 
  filteredConversations, 
  isSearching = false,
  searchQuery = '',
  filter,
  openedPath,
  onCreateInWorkspace,
}: ConversationSidebarProps) {
  const storeConversations = useChatStore((state) => state.conversations);
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  const setCurrentConversation = useChatStore((state) => state.setCurrentConversation);
  const deleteConversation = useChatStore((state) => state.deleteConversation);
  const renameConversation = useChatStore((state) => state.renameConversation);
  const toggleStarConversation = useChatStore((state) => state.toggleStarConversation);
  const duplicateConversation = useChatStore((state) => state.duplicateConversation);
  const isLoading = useChatStore((state) => state.isLoadingConversations);

  const conversationsToShow = filteredConversations ?? storeConversations;
  const grouping = useUiPreferences((state) => state.conversationGrouping);
  const mountedDirectories = useConversationAttachmentStore((state) => state.mountedDirByConversation);
  const locale = useLocaleStore((state) => state.locale);
  const t = useLocaleStore((state) => state.t);
  const openedWorkspaces = useConversationAttachmentStore((state) => state.openedWorkspaces);
  const archivedWorkspaces = useConversationAttachmentStore((state) => state.archivedWorkspaces);
  const archivedConversations = useConversationAttachmentStore((state) => state.archivedConversations);
  const [collapsed, setCollapsed] = useState<Set<string | null>>(() => new Set());
  const currentPath = workspacePath(currentConversationId ? mountedDirectories[currentConversationId] : null);
  useEffect(() => {
    const path = openedPath?.path;
    if (path === undefined) return;
    setCollapsed((previous) => {
      const next = new Set(previous);
      next.delete(path);
      return next;
    });
  }, [openedPath]);
  useEffect(() => {
    if (!currentConversationId) return;
    setCollapsed((previous) => {
      if (!previous.has(currentPath)) return previous;
      const next = new Set(previous);
      next.delete(currentPath);
      return next;
    });
  }, [currentConversationId, currentPath]);
  const rows = useMemo(() => {
    const registered = filter === 'recent' && !isSearching
      ? openedWorkspaces.filter((path) => !archivedWorkspaces[path])
      : undefined;
    const archivedEmpty = filter === 'archived' && !isSearching
      ? openedWorkspaces.filter((path) => archivedWorkspaces[path])
      : undefined;
    const result = conversationSidebarRows(conversationsToShow, grouping, mountedDirectories, undefined, registered ?? archivedEmpty, isSearching ? undefined : collapsed);
    return archivedEmpty ? result.filter((row) => row.kind !== 'heading' || row.group.kind !== 'workspace' || row.group.path !== null || conversationsToShow.some((chat) => !mountedDirectories[chat.id])) : result;
  }, [conversationsToShow, grouping, mountedDirectories, openedWorkspaces, archivedWorkspaces, filter, isSearching, collapsed]);
  const workspaceNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (row.kind !== 'heading' || row.group.kind !== 'workspace' || !row.group.path) continue;
      const name = workspaceGroupName(row.group.path);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return counts;
  }, [rows]);
  const ensureMessagesLoaded = useChatStore((state) => state.ensureMessagesLoaded);
  const hoverTimersRef = useRef<Record<string, number>>({});
  const prefetchInFlightRef = useRef<Set<string>>(new Set());

  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null);
  const [renameInputValue, setRenameInputValue] = useState("");
  const [clickTimeoutId] = useState<NodeJS.Timeout | null>(null);
  const [conversationToDelete, setConversationToDelete] = useState<Conversation | null>(null);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  
  const handleDeleteClick = (e: any, conv: Conversation) => {
    if (e?.preventDefault) {
      e.preventDefault();
    }
    setConversationToDelete(conv);
    setIsAlertOpen(true);
  };
  
  const handleConfirmDelete = async () => {
    if (!conversationToDelete) return;
    try {
      await deleteConversation(conversationToDelete.id);
      setIsAlertOpen(false);
      setConversationToDelete(null);
    } catch {
      toast.error(t('chatSidebar.deleteFailed'));
    }
  };

  // 保留双击标题进入重命名

  const handleTitleDoubleClick = (e: any, conv: Conversation) => {
    if (e?.preventDefault) e.preventDefault();
    setRenamingConversationId(conv.id);
    setRenameInputValue(conv.title);
  };

  const handleTitleClick = (e: any, conv: Conversation) => {
    if (e?.preventDefault) e.preventDefault();
    setCurrentConversation(conv.id);
  };

  const handleRenameSubmit = async () => {
    if (!renamingConversationId || !renameInputValue.trim()) return;
    await renameConversation(renamingConversationId, renameInputValue.trim());
    setRenamingConversationId(null);
    setRenameInputValue('');
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      setRenamingConversationId(null);
      setRenameInputValue('');
    }
  };

  useEffect(() => {
    return () => {
      if (clickTimeoutId) {
        clearTimeout(clickTimeoutId);
      }
    };
  }, [clickTimeoutId]);

  // 星标直接使用 toggleStarConversation

  const handleDuplicateConversation = (conversationId: string) => {
    duplicateConversation(conversationId);
  };

  const downloadConversation = async (id: string) => {
    const conv = storeConversations.find(c => c.id === id) || null;
    await exportConversationMarkdown(conv, id);
  };

  if (isLoading) {
    return (
      <ScrollArea className="flex-1 p-2 h-full">
        <div className="flex justify-center items-center h-full">
          <FoldingLoader size={28} />
        </div>
      </ScrollArea>
    );
  }

  if (!rows.length) {
    return (
      <ScrollArea className="flex-1 px-1 pt-1 pb-2 h-full">
        <div className="text-center text-slate-500 dark:text-slate-400 py-10 px-4">
          {isSearching ? (
            <>
              <SearchIcon className="h-8 w-8 mx-auto mb-2 text-slate-400 dark:text-slate-500" />
              <p>没有找到与 "{searchQuery}" 相关的会话</p>
            </>
          ) : (
            <div className="space-y-2">
              <MessageSquare className="h-6 w-6 mx-auto text-slate-400/60 dark:text-slate-500/60" />
              <p className="text-xs">{filter === 'archived' ? t('chatSidebar.emptyArchive') : '无对话记录，选择一个模型开始对话'}</p>
            </div>
          )}
        </div>
      </ScrollArea>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex-1 px-2 pt-1.5 pb-2 h-full">
        <Virtuoso
          key={grouping}
          data={rows}
          useWindowScroll={false}
          increaseViewportBy={200}
          computeItemKey={(_index, row) => row.key}
          itemContent={(index, row) => {
            if (row.kind === 'heading') {
              const group = row.group;
              const path = group.kind === 'workspace' ? group.path : null;
              const title = group.kind === 'time'
                ? t(`chatSidebar.${group.id}`)
                : path ? workspaceGroupName(path) : t('chatSidebar.defaultWorkspace');
              const parent = path && (workspaceNames.get(title) ?? 0) > 1 ? workspaceGroupParent(path) : null;
              if (group.kind === 'workspace') {
                const expanded = isSearching || !collapsed.has(path);
                const active = Boolean(currentConversationId) && path === currentPath;
                const Icon = active ? FolderOpen : Folder;
                const archived = Boolean(path && archivedWorkspaces[path]);
                const createAction = !archived && filter !== 'archived' ? [{
                  id: 'new-conversation', text: t('chatSidebar.newConversationInWorkspace'),
                  action: () => {
                    setCollapsed((previous) => {
                      const next = new Set(previous);
                      next.delete(path);
                      return next;
                    });
                    void onCreateInWorkspace(path);
                  },
                }] : [];
                const rowActions = [...createAction, ...(path ? [
                  { id: 'reveal-workspace', text: t('chatSidebar.revealWorkspace'), action: () => {
                    void FileOpener.openDirectory(path).then((opened) => {
                      if (!opened) toast.error(t('chatSidebar.openWorkspaceFailed'));
                    });
                  } },
                  { id: 'archive-workspace', text: t(archived ? 'chatSidebar.restore' : 'chatSidebar.archive'), action: () => {
                    const state = useConversationAttachmentStore.getState();
                    state.registerWorkspace(path);
                    state.archiveWorkspace(path, !archived);
                  } },
                ] : [])];
                const header = (
                  <div className="flex min-w-0 items-center gap-1 px-1">
                    <button type="button" aria-expanded={expanded} aria-current={active ? 'true' : undefined} title={path ?? title}
                      className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left text-sm font-semibold leading-5 text-slate-900 hover:bg-slate-500/10 focus-visible:outline-2 focus-visible:outline-sky-600 dark:text-slate-100 dark:focus-visible:outline-sky-400"
                      onClick={() => !isSearching && setCollapsed((previous) => {
                        const next = new Set(previous);
                        if (next.has(path)) next.delete(path);
                        else next.add(path);
                        return next;
                      })}>
                      <ChevronRight aria-hidden="true" className={`size-3 shrink-0 text-slate-500 dark:text-slate-400 ${expanded ? 'rotate-90' : ''}`} />
                      <Icon aria-hidden="true" className={`size-4 shrink-0 ${active ? 'text-sky-700 dark:text-sky-300' : 'text-slate-500 dark:text-slate-400'}`} />
                      <span className="truncate">{title}</span>
                      {parent && <span className="min-w-0 truncate text-xs font-normal text-slate-600 dark:text-slate-300">{parent}</span>}
                    </button>
                  </div>
                );
                return <div className={index === 0 ? '' : 'mt-2 border-t border-slate-500/15 pt-2 dark:border-slate-300/15'}>
                  {rowActions.length > 0 ? <ContextMenu menuItems={rowActions}>{header}</ContextMenu> : header}
                  {expanded && filter === 'recent' && !isSearching && rows[index + 1]?.kind !== 'conversation' && (
                    <p className="pb-2 pl-9 text-xs leading-4 text-slate-600 dark:text-slate-300">{t('chatSidebar.emptyWorkspace')}</p>
                  )}
                </div>;
              }
              return (
                <div className={index === 0 ? 'pb-1 pt-1' : 'pt-3 pb-1'}>
                  <h3
                    title={path ?? undefined}
                    className="flex min-w-0 items-center gap-2 px-3 text-xs font-semibold leading-5 text-slate-700 dark:text-slate-200"
                  >
                    <span className="truncate">{title}</span>
                  </h3>
                </div>
              );
            }
            const conv = row.conversation;
            const memberPath = workspacePath(mountedDirectories[conv.id]);
            const archivedByWorkspace = Boolean(memberPath && archivedWorkspaces[memberPath]);
            return (
            <div
              className={grouping === 'workspace' ? 'mb-0.5 pl-4' : 'mb-0.5'}
              onMouseEnter={() => {
                try {
                  const id = conv.id;
                  // 已有消息或正在预取/已有计时器则跳过
                  if ((Array.isArray(conv.messages) && conv.messages.length > 0)) return;
                  if (hoverTimersRef.current[id]) return;
                  if (prefetchInFlightRef.current.has(id)) return;
                  hoverTimersRef.current[id] = window.setTimeout(() => {
                    // 悬停短暂后异步预加载消息（一次性、去重、不阻塞UI）
                    if (prefetchInFlightRef.current.has(id)) {
                      // 已在进行，直接清理计时器
                      window.clearTimeout(hoverTimersRef.current[id]);
                      delete hoverTimersRef.current[id];
                      return;
                    }
                    prefetchInFlightRef.current.add(id);
                    void ensureMessagesLoaded(id).finally(() => {
                      prefetchInFlightRef.current.delete(id);
                    });
                    // 触发后立即清理计时器
                    window.clearTimeout(hoverTimersRef.current[id]);
                    delete hoverTimersRef.current[id];
                  }, 180);
                } catch {}
              }}
              onMouseLeave={() => {
                try {
                  const id = conv.id;
                  if (hoverTimersRef.current[id]) {
                    window.clearTimeout(hoverTimersRef.current[id]);
                    delete hoverTimersRef.current[id];
                  }
                } catch {}
              }}
            >
              <ConversationItem
                key={conv.id}
                conversation={conv}
                locale={locale}
                isCurrent={currentConversationId === conv.id}
                isRenaming={renamingConversationId === conv.id}
                renameInputValue={renameInputValue}
                onSelect={setCurrentConversation}
                onRenameStart={handleTitleDoubleClick}
                onTitleClick={handleTitleClick}
                onRenameChange={setRenameInputValue}
                onRenameSubmit={handleRenameSubmit}
                onRenameBlur={handleRenameSubmit}
                onRenameKeyDown={handleRenameKeyDown}
                onDelete={handleDeleteClick}
                onStar={toggleStarConversation}
                onDuplicate={handleDuplicateConversation}
                onExport={downloadConversation}
                archiveLabel={t(archivedConversations[conv.id] ? 'chatSidebar.restore' : archivedByWorkspace ? 'chatSidebar.restoreWorkspace' : 'chatSidebar.archive')}
                onArchive={() => {
                  const state = useConversationAttachmentStore.getState();
                  if (memberPath && archivedByWorkspace && !state.archivedConversations[conv.id]) {
                    state.archiveWorkspace(memberPath, false);
                  } else state.archiveConversation(conv.id, !state.archivedConversations[conv.id]);
                }}
              />
            </div>
            );
          }}
          // A conversation list scrolls vertically only. Virtuoso's scroller
          // defaults to `overflow-x: auto`, so one wide child (a long model name)
          // is enough to grow a horizontal scrollbar.
          style={{ height: '100%', overflowX: 'hidden' }}
        />
      </div>
      <DeleteConversationDialog
        isOpen={isAlertOpen}
        onOpenChange={setIsAlertOpen}
        onConfirm={handleConfirmDelete}
        conversation={conversationToDelete}
      />
    </TooltipProvider>
  );
} 
