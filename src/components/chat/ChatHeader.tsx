'use client';

import { useState } from 'react';
import { useChatStore } from '@/store/chatStore';
import {
  Ellipsis,
  FolderOpen,
  MessageSquarePlus,
  PanelLeft,
  Settings,
} from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { useConversationAttachmentStore } from '@/store/conversationAttachmentStore';
import { useTranslation } from '@/i18n/useTranslation';
import { workspaceGroupName } from '@/lib/chat/conversationGroups';
import { FileOpener } from '@/lib/utils/fileOpener';
import { revealConversationWorkspace } from '@/lib/agentWorkspace/workspaceService';
import { toast } from '@/components/ui/sonner';
import { ModelSelector } from './ModelSelector';
import { ProviderMetadata } from '@/lib/metadata/types';
import { DeleteConversationDialog } from './DeleteConversationDialog';
import { EditableTitle } from './EditableTitle';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useSidebar } from '@/contexts/SidebarContext';
import { PromptPill } from './PromptPill';
import { useEffect } from 'react';
import {
  getEnabledConfiguredServers,
  getConnectedServers,
  getEnabledServersForConversation,
  setEnabledServersForConversation,
} from '@/lib/mcp/chatIntegration';
import { LocateFixed } from 'lucide-react';
import { MessageNavigationMenu } from './MessageNavigationMenu';
import { ThinkingLevelSwitch } from './ThinkingLevelSwitch';
import type { Message } from '@/types/chat';
import type { ModelParameters } from '@/types/model-params';

import { ConversationApprovalControl } from './ConversationApprovalControl';

interface ChatHeaderProps {
  title: string;
  tags?: string[];
  onShare?: () => void;
  onDownload?: () => void;
  onTitleChange: (newTitle: string) => void;
  onDelete: () => void;
  allMetadata: ProviderMetadata[];
  currentModelId: string | null;
  currentProviderName?: string;
  onModelChange: (newModelId: string) => void;
  isModelSelectorDisabled?: boolean;
  hideModelSelector?: boolean;
  tokenCount?: number;
  /** 会话参数：入口从输入框迁移到右上角三点菜单 */
  hasSessionParameters?: boolean;
  onOpenSessionParameters?: () => void;
  /** 消息导航（长会话里跳转到指定消息）；为空时不显示入口 */
  /** #100: the quick thinking switch lives beside the model selector. */
  sessionParameters?: ModelParameters | null;
  onSessionParametersSaved?: () => void | Promise<void>;
  navigationMessages?: Message[];
  onNavigateToMessage?: (messageId: string) => void;
}

export function ChatHeader({
  title,
  tags,
  onShare,
  onDownload,
  onTitleChange,
  onDelete,
  allMetadata,
  currentModelId,
  currentProviderName,
  onModelChange: handleModelChange,
  isModelSelectorDisabled = false,
  hideModelSelector = false,
  tokenCount: _tokenCount = 0,
  hasSessionParameters,
  onOpenSessionParameters,
  sessionParameters,
  onSessionParametersSaved,
  navigationMessages,
  onNavigateToMessage,
}: ChatHeaderProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [_mcpAll, setMcpAll] = useState<string[]>([]);
  const [_mcpConnected, setMcpConnected] = useState<string[]>([]);
  const conversationId = useChatStore((s) => s.currentConversationId);
  const directory = useConversationAttachmentStore((s) =>
    conversationId ? s.mountedDirByConversation[conversationId] : undefined,
  );
  const t = useTranslation();
  const workspaceName = directory
    ? workspaceGroupName(directory)
    : t('chatSidebar.defaultWorkspace');
  const revealWorkspace = async () => {
    if (!conversationId) return;
    try {
      if (directory) {
        if (!(await FileOpener.openDirectory(directory)))
          throw new Error('Could not reveal directory');
      } else await revealConversationWorkspace(conversationId);
    } catch {
      toast.error(t('chatSidebar.openWorkspaceFailed'));
    }
  };
  const [enabledForConv, setEnabledForConv] = useState<string[]>([]);

  const { toggleSidebar, isSidebarOpen, newConversation } = useSidebar();

  const handleConfirmDelete = () => {
    onDelete();
    setShowDeleteConfirm(false);
  };

  // 初始化 MCP 列表与会话选择
  useEffect(() => {
    (async () => {
      setMcpAll(await getEnabledConfiguredServers());
      setMcpConnected(await getConnectedServers());
      if (conversationId)
        setEnabledForConv(
          await getEnabledServersForConversation(conversationId),
        );
    })();
  }, [conversationId]);

  const _toggleServer = async (name: string) => {
    let next: string[];
    if (enabledForConv.includes(name))
      next = enabledForConv.filter((n) => n !== name);
    else next = [...enabledForConv, name];
    setEnabledForConv(next);
    if (conversationId)
      await setEnabledServersForConversation(conversationId, next);
  };

  return (
    <>
      <div className="app-topbar h-9 px-3 border-b border-slate-200/60 dark:border-white/10 flex items-center justify-between glass-surface">
        {/* 左侧：侧栏开关 + 标题 */}
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <button
            onClick={toggleSidebar}
            className="p-1.5 rounded-md hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors"
            title={t('chatSidebar.toggle')}
            aria-label={t('chatSidebar.toggle')}
          >
            <PanelLeft className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          </button>

          {!isSidebarOpen && (
            <IconButton
              onClick={() => void newConversation()}
              title={t('chatSidebar.newConversation')}
              aria-label={t('chatSidebar.newConversation')}
              icon={MessageSquarePlus}
              size="sm"
            />
          )}

          {conversationId && (
            <>
              <button
                type="button"
                title={directory ?? t('chatSidebar.revealWorkspace')}
                aria-label={`${t('chatSidebar.currentWorkspace')}: ${workspaceName} · ${t('chatSidebar.revealWorkspace')}`}
                className="flex h-7 min-w-0 max-w-[min(24vw,10rem)] shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-slate-600 hover:bg-slate-500/10 focus-visible:outline-2 focus-visible:outline-sky-600 dark:text-slate-300 dark:focus-visible:outline-sky-400"
                onClick={() => void revealWorkspace()}
              >
                <FolderOpen aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate">{workspaceName}</span>
              </button>
              <span
                aria-hidden="true"
                className="text-xs text-slate-500 dark:text-slate-400"
              >
                /
              </span>
            </>
          )}
          <EditableTitle
            initialTitle={title}
            onTitleChange={onTitleChange}
            className="text-[13px] font-medium text-slate-600 dark:text-slate-300 ml-0.5 min-w-0 max-w-[min(40vw,20rem)]"
            inputClassName="text-[13px]"
          />

          {tags?.map((tag, index) => (
            <span
              key={index}
              className="text-[10px] text-slate-500 dark:text-slate-400 px-1.5 py-0.5 bg-slate-100/60 dark:bg-slate-800/40 rounded-md hidden sm:inline"
            >
              {tag}
            </span>
          ))}
          <div className="flex-1 h-8 min-w-2" data-tauri-drag-region />
        </div>

        {/* 右侧：模型选择为主控件，按名称向左撑开 */}
        <div className="flex items-center gap-0.5 shrink-0">
          {!hideModelSelector && (
            <ModelSelector
              allMetadata={allMetadata}
              currentModelId={currentModelId}
              currentProviderName={currentProviderName}
              onModelChange={handleModelChange}
              disabled={isModelSelectorDisabled}
            />
          )}

          <ThinkingLevelSwitch
            provider={currentProviderName || ''}
            modelId={currentModelId}
            conversationId={conversationId || ''}
            sessionParameters={sessionParameters}
            onSessionParametersSaved={onSessionParametersSaved}
            disabled={isModelSelectorDisabled || !currentProviderName}
          />

          <PromptPill />
          {conversationId && (
            <ConversationApprovalControl
              key={conversationId}
              conversationId={conversationId}
            />
          )}

          {/* 消息导航：长会话里跳转到指定消息。放在头部而不是悬浮在消息上，避免遮挡内容 */}
          {onNavigateToMessage && (navigationMessages?.length || 0) >= 2 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="p-1.5 rounded-md hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors"
                  title={t('chatUi.messageNavigation')}
                  aria-label={t('chatUi.messageNavigation')}
                >
                  <LocateFixed className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                </button>
              </DropdownMenuTrigger>
              <MessageNavigationMenu
                messages={navigationMessages || []}
                onNavigateToMessage={onNavigateToMessage}
                onClose={() => {}}
              />
            </DropdownMenu>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="p-1.5 rounded-md hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors"
                title={t('conversation.moreActions')}
                aria-label={t('conversation.moreActions')}
              >
                <Ellipsis className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36 text-xs">
              <DropdownMenuItem
                onSelect={() => void newConversation()}
                className="text-xs"
              >
                {t('chatSidebar.newConversation')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onShare} className="text-xs">
                {t('chatUi.share')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onDownload} className="text-xs">
                {t('conversation.export')}
              </DropdownMenuItem>
              {onOpenSessionParameters && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={onOpenSessionParameters}
                    className="text-xs"
                  >
                    <Settings className="w-3 h-3 mr-1.5" />
                    {t('chatUi.parameters')}
                    {hasSessionParameters && (
                      <span className="ml-auto text-[9px] text-slate-400">
                        ·
                      </span>
                    )}
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setShowDeleteConfirm(true)}
                className="text-xs"
              >
                {t('conversation.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <DeleteConversationDialog
        isOpen={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        onConfirm={handleConfirmDelete}
        conversation={{ title } as any}
      />
    </>
  );
}
