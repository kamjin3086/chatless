"use client";

import { useState } from 'react';
import { useChatStore } from '@/store/chatStore';
import { Ellipsis, PanelLeft, PenLine, Settings } from 'lucide-react';
import { ModelSelector } from "./ModelSelector";
import { ProviderMetadata } from "@/lib/metadata/types";
import { DeleteConversationDialog } from './DeleteConversationDialog';
import { EditableTitle } from './EditableTitle';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useSidebar } from '@/contexts/SidebarContext';
import { PromptPill } from './PromptPill';
import { useEffect } from 'react';
import { getEnabledConfiguredServers, getConnectedServers, getEnabledServersForConversation, setEnabledServersForConversation } from '@/lib/mcp/chatIntegration';

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
  tokenCount?: number;
  /** 会话参数：入口从输入框迁移到右上角三点菜单 */
  hasSessionParameters?: boolean;
  onOpenSessionParameters?: () => void;
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
  tokenCount: _tokenCount = 0,
  hasSessionParameters,
  onOpenSessionParameters,
}: ChatHeaderProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [_mcpAll, setMcpAll] = useState<string[]>([]);
  const [_mcpConnected, setMcpConnected] = useState<string[]>([]);
  const conversationId = useChatStore((s)=>s.currentConversationId);
  const [enabledForConv, setEnabledForConv] = useState<string[]>([]);

  const createConversation = useChatStore((state) => state.createConversation);
  const { toggleSidebar, isSidebarOpen } = useSidebar();

  const handleNewChat = async () => {
    const defaultModelId = 'default-model';
    const now = new Date();
    const newTitle = `新对话 ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    await createConversation(newTitle, defaultModelId);
  };

  const handleConfirmDelete = () => {
    onDelete();
    setShowDeleteConfirm(false);
  };

  // 初始化 MCP 列表与会话选择
  useEffect(() => {
    (async () => {
      setMcpAll(await getEnabledConfiguredServers());
      setMcpConnected(await getConnectedServers());
      if (conversationId) setEnabledForConv(await getEnabledServersForConversation(conversationId));
    })();
  }, [conversationId]);

  const _toggleServer = async (name: string) => {
    let next: string[];
    if (enabledForConv.includes(name)) next = enabledForConv.filter(n => n !== name);
    else next = [...enabledForConv, name];
    setEnabledForConv(next);
    if (conversationId) await setEnabledServersForConversation(conversationId, next);
  };

  return (
    <>
      <div className="h-9 px-2 border-b border-slate-200/30 dark:border-slate-700/20 flex items-center justify-between bg-white/90 dark:bg-slate-900/90">
        {/* 左侧：侧边栏切换 + 新建 + 标题 */}
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <button 
            onClick={toggleSidebar} 
            className="p-1.5 rounded hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors" 
            title="侧边栏"
          >
            <PanelLeft className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          </button>
          
          {!isSidebarOpen && (
            <button
              onClick={handleNewChat}
              className="p-1.5 rounded hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors"
              title="新建"
            >
              <PenLine className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            </button>
          )}
          
          <EditableTitle
            initialTitle={title}
            onTitleChange={onTitleChange}
            className="text-xs text-slate-600 dark:text-slate-300 truncate ml-1"
            inputClassName="text-xs"
          />
          
          {tags?.map((tag, index) => (
            <span
              key={index}
              className="text-[10px] text-slate-500 dark:text-slate-400 px-1.5 py-0.5 bg-slate-100/60 dark:bg-slate-800/40 rounded"
            >
              {tag}
            </span>
          ))}
        </div>
        
        {/* 右侧：模型选择 + 提示词 + 更多 */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <ModelSelector 
            allMetadata={allMetadata}
            currentModelId={currentModelId}
            currentProviderName={currentProviderName}
            onModelChange={handleModelChange}
            disabled={isModelSelectorDisabled}
          />
          
          <PromptPill />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button 
                className="p-1.5 rounded hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors"
                title="更多"
              >
                <Ellipsis className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36 text-xs">
              <DropdownMenuItem onSelect={handleNewChat} className="text-xs">新建对话</DropdownMenuItem>
              <DropdownMenuItem onSelect={onShare} className="text-xs">分享</DropdownMenuItem>
              <DropdownMenuItem onSelect={onDownload} className="text-xs">导出</DropdownMenuItem>
              {onOpenSessionParameters && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onOpenSessionParameters} className="text-xs">
                    <Settings className="w-3 h-3 mr-1.5" />
                    参数
                    {hasSessionParameters && <span className="ml-auto text-[9px] text-slate-400">·</span>}
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setShowDeleteConfirm(true)} className="text-xs">
                删除
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