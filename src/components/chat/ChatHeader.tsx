"use client";

import { useState } from 'react';
import { useChatStore } from '@/store/chatStore';
import { MoreVertical, Menu, Plus, Settings } from 'lucide-react';
import { ModelSelector } from "./ModelSelector";
import { ProviderMetadata } from "@/lib/metadata/types";
import { DeleteConversationDialog } from './DeleteConversationDialog';
import { EditableTitle } from './EditableTitle';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useSidebar } from '@/contexts/SidebarContext';
import { PromptPill } from './PromptPill';
import { useEffect } from 'react';
import { getEnabledConfiguredServers, getConnectedServers, getEnabledServersForConversation, setEnabledServersForConversation } from '@/lib/mcp/chatIntegration';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

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
      <div className="px-3 sm:px-4 md:px-6 py-2 border-b border-slate-200/50 dark:border-slate-700/40 flex items-center justify-between bg-gradient-to-r from-slate-50/60 via-white/40 to-slate-50/60 dark:from-slate-900/60 dark:via-slate-800/40 dark:to-slate-900/60 backdrop-blur-xl shadow-sm transition-all">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <button onClick={toggleSidebar} className="p-2 rounded-lg hover:bg-slate-100/80 dark:hover:bg-slate-700/60 transition-all duration-200 cursor-pointer" title="切换侧边栏">
            <Menu className="w-5 h-5 text-slate-600 dark:text-slate-400" />
          </button>
          
          {/* 会话栏折叠时显示新建按钮 */}
          {!isSidebarOpen && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleNewChat}
                    className="text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <Plus className="w-5 h-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>新建对话</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          
          <EditableTitle
            initialTitle={title}
            onTitleChange={onTitleChange}
            className="font-medium text-sm sm:text-sm text-gray-800 dark:text-gray-200 truncate"
            inputClassName="text-sm sm:text-sm font-medium"
          />
          
          {tags?.map((tag, index) => (
            <span
              key={index}
              className="bg-gradient-to-r from-indigo-50 to-indigo-100/80 text-indigo-700 dark:from-indigo-900/40 dark:to-indigo-800/30 dark:text-indigo-300 text-xs px-3 py-1 rounded-full border border-indigo-200/50 dark:border-indigo-700/50"
            >
              {tag}
            </span>
          ))}
        </div>
        
        <div className="flex items-center gap-2 sm:gap-3 bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm px-2 sm:px-3 md:px-4 py-1 sm:py-1.5 rounded-xl border border-slate-200/50 dark:border-slate-700/50 shadow-sm flex-shrink-0">
          <ModelSelector 
            allMetadata={allMetadata}
            currentModelId={currentModelId}
            currentProviderName={currentProviderName}
            onModelChange={handleModelChange}
            disabled={isModelSelectorDisabled}
          />
          {/* 旧的右上角 MCP 选择已移除，改为输入框上拉面板 */}
          <div className="text-xs">
            <PromptPill />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                title="更多操作" 
                className="text-gray-600 dark:text-gray-300 focus:outline-none focus:ring-0 focus:ring-offset-0 cursor-pointer"
              >
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onSelect={handleNewChat}>新建对话</DropdownMenuItem>
              <DropdownMenuItem onSelect={onShare}>分享对话</DropdownMenuItem>
              <DropdownMenuItem onSelect={onDownload}>导出对话</DropdownMenuItem>
              {onOpenSessionParameters ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onOpenSessionParameters}>
                    <div className="flex items-center gap-2">
                      <Settings className="w-4 h-4" />
                      <span>会话参数</span>
                      {hasSessionParameters ? (
                        <span className="ml-auto text-[10px] text-slate-500">已设置</span>
                      ) : null}
                    </div>
                  </DropdownMenuItem>
                </>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setShowDeleteConfirm(true)}>
                删除对话
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