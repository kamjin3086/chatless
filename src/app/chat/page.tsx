"use client";

import { useState, useEffect, useRef } from 'react';
import { ChatInput } from '@/components/chat/ChatInput';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatToolbar } from '@/components/chat/ChatToolbar';
import { NewMessageIndicator } from '@/components/chat/NewMessageIndicator';
import { SessionParametersDialog } from '@/components/chat/SessionParametersDialog';
import type { Message } from "@/types/chat";
import { useChatStore } from "@/store/chatStore";
import { useSearchParams } from 'next/navigation';

import { ChatInitializing } from '@/components/chat/ChatInitializing';
import { EmptyChatView } from '@/components/chat/EmptyChatView';
import { ChatMessageList } from '@/components/chat/ChatMessageList';
import { FloatingSkillApprovalPanel } from '@/components/skills/SkillApprovalPanel';
import { FloatingSkillExecutionPlanPanel } from '@/components/skills/SkillExecutionPlanPanel';

import { useModelSelection } from '@/hooks/useModelSelection';
import { useChatActions } from '@/hooks/useChatActions';
import { useScrollManagement } from '@/hooks/useScrollManagement';
import type { ModelParameters } from '@/types/model-params';
import { ModelParametersService } from '@/lib/model-parameters';

type StoreMessage = any;

interface Conversation {
  id: string;
  title: string;
  messages: StoreMessage[];
  createdAt: number;
  updatedAt: number;
  tags?: string[];
}

export default function ChatPage() {
  const [isClient, setIsClient] = useState(false);
  const [isInputAreaHovered, setIsInputAreaHovered] = useState(false);
  const ensureMessagesLoaded = useChatStore((state) => state.ensureMessagesLoaded);
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  const currentConversation = useChatStore((state) => {
    const id = state.currentConversationId;
    return id ? (state.conversations.find((c:any) => c.id === id) as Conversation | undefined) : null;
  });
  
  const searchParams = useSearchParams();
  const selectedKnowledgeBaseId = searchParams.get('knowledgeBase');
  const deepLinkConversationId = searchParams.get('conversation') || searchParams.get('conversationId');
  const setCurrentConversation = useChatStore((s)=>s.setCurrentConversation);
  
  const { 
    llmInitialized, 
    allMetadata, 
    selectedModelId, 
    currentProviderName, 
    handleModelChange 
  } = useModelSelection();

  // 会话参数相关状态
  const [currentSessionParameters, setCurrentSessionParameters] = useState<ModelParameters | undefined>(undefined);
  const [sessionParametersDialogOpen, setSessionParametersDialogOpen] = useState(false);

  // 加载会话参数
  useEffect(() => {
    if (currentConversationId) {
      loadSessionParameters();
    } else {
      setCurrentSessionParameters(undefined);
    }
  }, [currentConversationId]);

  const loadSessionParameters = async () => {
    try {
      if (currentConversationId) {
        const sessionParams = await ModelParametersService.getSessionParameters(currentConversationId);
        setCurrentSessionParameters(sessionParams || undefined);
      }
    } catch (error) {
      console.error('加载会话参数失败:', error);
      setCurrentSessionParameters(undefined);
    }
  };

  const {
    isLoading,
    handleSendMessage,
    handleStopGeneration,
    handleEmptyStatePromptClick,
    handleTitleChange,
    handleDeleteConversation,
    handleRetryMessage,
    handleShare,
    handleDownload,
    handleImageUpload,
    handleFileUpload,
    tokenCount,
    setScrollToBottomCallback,
  } = useChatActions(selectedModelId, currentProviderName, currentSessionParameters);

  // 编辑消息相关状态
  interface EditingMessageData {
    content: string;
    documentReference?: {
      fileName: string;
      fileType: string;
      fileSize: number;
      summary: string;
    };
    contextData?: string;
    knowledgeBaseReference?: { id: string; name: string };
  }
  const [editingMessage, setEditingMessage] = useState<EditingMessageData | null>(null);
  
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const {
    messageRefs,
    messagesEndRef: managedEndRef,
    handleScrollToTop,
    handleScrollToBottom,
    ensureBottomIfNear,
    showScrollToBottom: _showScrollToBottom,
    hasNewMessageWhileAway,
    shouldFollowOutput
  } = useScrollManagement(
      scrollContainerRef,
      currentConversation?.messages as Message[] | undefined,
      currentConversationId,
      isLoading
  );

  // 注册 Virtuoso 的按ID滚动API，供“跳转到消息”使用
  const scrollToMessageRef = useRef<((id: string) => void) | null>(null);
  const registerScrollToMessage = (fn: (id: string) => void) => { scrollToMessageRef.current = fn; };
  // 轻动画高亮暂时关闭
  const _highlightMessage = (_id: string, _retries: number = 0) => {};
  // 统一的消息定位：将目标消息放置在视口约 35% 位置
  const TARGET_VIEWPORT_BIAS = 0.35; // 0 顶部, 1 底部
  const scrollToMessageWithBias = (id: string, options?: { smooth?: boolean; retries?: number }) => {
    const smooth = options?.smooth ?? false;
    const retries = options?.retries ?? 8;
    const container = scrollContainerRef.current;
    if (!container) return;
    const el = messageRefs.current[id];
    if (el) {
      try {
        const crect = container.getBoundingClientRect();
        const erect = el.getBoundingClientRect();
        const delta = erect.top - crect.top;
        const desired = container.scrollTop + delta - container.clientHeight * TARGET_VIEWPORT_BIAS;
        const max = Math.max(0, container.scrollHeight - container.clientHeight);
        const target = Math.min(max, Math.max(0, desired));
        container.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' });
      } catch { /* noop */ }
      return;
    }
    if (retries > 0) {
      window.setTimeout(() => scrollToMessageWithBias(id, { smooth, retries: retries - 1 }), 60);
    }
  };
  // 进入/切换会话时定位到“最后一条用户消息”，不再强制到底部
  const initialAnchoredRef = useRef(false);
  useEffect(() => {
    initialAnchoredRef.current = false;
  }, [currentConversationId]);

  useEffect(() => {
    if (initialAnchoredRef.current) return;
    const msgs = (currentConversation?.messages as Message[] | undefined) || [];
    const lastUser = [...msgs].reverse().find(m => m.role === 'user');
    if (!lastUser) return; // 没有用户消息则不主动滚动
    const doScroll = () => {
      if (scrollToMessageRef.current) {
        scrollToMessageRef.current(lastUser.id);
      }
      scrollToMessageWithBias(lastUser.id, { smooth: false, retries: 10 });
      initialAnchoredRef.current = true;
    };
    const raf = requestAnimationFrame(doScroll);
    return () => cancelAnimationFrame(raf);
  }, [currentConversationId, currentConversation?.messages?.length]);

  // 新消息追加后：仅当用户已接近底部时，才对齐到底部（轻量滚动）
  useEffect(() => {
    const len = (currentConversation?.messages as Message[] | undefined)?.length || 0;
    if (len === 0) return;
    // 初次进入会话定位尚未完成时，避免把视图拉到底部
    if (!initialAnchoredRef.current) return;
    ensureBottomIfNear();
  }, [currentConversation?.messages?.length]);

  // 从后台切回到该标签页时，若尚未完成初次定位则先锚定到最后一条用户消息，否则确保到底部
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!initialAnchoredRef.current) {
        const msgs = (currentConversation?.messages as Message[] | undefined) || [];
        const lastUser = [...msgs].reverse().find(m => m.role === 'user');
        if (!lastUser) return;
        if (scrollToMessageRef.current) {
          scrollToMessageRef.current(lastUser.id);
        }
        scrollToMessageWithBias(lastUser.id, { smooth: false, retries: 10 });
        initialAnchoredRef.current = true;
        return;
      }
      handleScrollToBottom();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [handleScrollToBottom, currentConversation?.messages]);

  // 设置滚动到底部的回调函数
  useEffect(() => {
    setScrollToBottomCallback(() => {
      handleScrollToBottom();
    });
  }, [setScrollToBottomCallback, handleScrollToBottom]);

  const navigateToMessage = (msgId: string) => {
    scrollToMessageWithBias(msgId, { smooth: true, retries: 10 });
  };

  useEffect(() => {
    setIsClient(true);
  }, []);

  // 处理从历史记录等处带参跳转
  useEffect(() => {
    if (deepLinkConversationId) {
      setCurrentConversation(deepLinkConversationId);
    }
  }, [deepLinkConversationId, setCurrentConversation]);

  // 惰性加载：当切换到某个会话时才加载其消息
  useEffect(() => {
    if (!currentConversationId) return;
    void ensureMessagesLoaded(currentConversationId);
  }, [currentConversationId, ensureMessagesLoaded]);

  // 实时渲染：直接使用会话消息，确保流式更新不被延迟
  const liveMessages = (currentConversation?.messages as Message[] | undefined) || [];

  const handleEditMessage = (messageId: string, _content: string) => {
    if (!currentConversation) return;
    const msg = (currentConversation.messages as Message[]).find(m => m.id === messageId);
    if (!msg) return;
    setEditingMessage({
      content: msg.content,
      documentReference: msg.document_reference,
      contextData: msg.context_data,
      knowledgeBaseReference: msg.knowledge_base_reference,
    });
    // 滚动到底部，确保输入框可见
    setTimeout(() => {
      scrollContainerRef.current?.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: 'smooth' });
    }, 0);
  };

  const handleCancelEdit = () => setEditingMessage(null);

  // 保存思考时长的回调函数
  const handleSaveThinkingDuration = (_messageId: string, _duration: number) => {
    // 这里可以添加额外的逻辑，比如记录到日志或发送到分析服务
  };

  // 处理会话参数变更
  const handleSessionParametersChange = (parameters: ModelParameters) => {
    setCurrentSessionParameters(parameters);
  };

  if (!isClient) {
    return <ChatInitializing />;
  }

  if (!currentConversationId || !currentConversation) {
    return (
      <EmptyChatView 
        allMetadata={allMetadata}
        selectedModelId={selectedModelId}
        onModelChange={handleModelChange}
        isLoading={isLoading}
        llmInitialized={llmInitialized}
        onSendMessage={handleSendMessage}
        onStopGeneration={handleStopGeneration}
        onPromptClick={handleEmptyStatePromptClick}
        selectedKnowledgeBaseId={selectedKnowledgeBaseId || undefined}
        onImageUpload={handleImageUpload}
        onFileUpload={handleFileUpload}
      />
    );
  }

  // 预留：如需根据消息时间显示工具栏，可以使用下方筛选（当前未用）
  // const toolbarMessages: Message[] = (currentConversation?.messages || [])
  //   .filter((msg): msg is Message & { created_at: number; updated_at: number } => 
  //     typeof msg.created_at === 'number' && typeof msg.updated_at === 'number'
  //   );

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      <ChatHeader
        title={currentConversation.title}
        tags={currentConversation.tags}
        onShare={handleShare}
        onDownload={handleDownload}
        onTitleChange={handleTitleChange}
        onDelete={handleDeleteConversation}
        allMetadata={allMetadata}
        currentModelId={selectedModelId}
        currentProviderName={currentProviderName}
        onModelChange={handleModelChange}
        isModelSelectorDisabled={isLoading}
        tokenCount={tokenCount}
        hasSessionParameters={!!currentSessionParameters}
        onOpenSessionParameters={() => setSessionParametersDialogOpen(true)}
      />
      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 flex flex-col">
          <div
            className="flex-1 custom-scrollbar"
            ref={scrollContainerRef}
            onMouseEnter={() => { if (scrollContainerRef.current) scrollContainerRef.current.style.overflowY = 'auto'; }}
            onMouseLeave={() => { if (scrollContainerRef.current) scrollContainerRef.current.style.overflowY = 'hidden'; }}
            style={{ overflowY: 'hidden', scrollbarGutter: 'stable' }}
          >
            <ChatMessageList
              chatId={currentConversationId}
              messages={liveMessages}
              isLoading={isLoading}
              onEditMessage={handleEditMessage}
              onRetryMessage={handleRetryMessage}
              onDeleteMessage={() => {}}
              onSaveThinkingDuration={handleSaveThinkingDuration}
              messageRefs={messageRefs}
              messagesEndRef={managedEndRef}
              scrollParentRef={scrollContainerRef}
              onRegisterScrollToMessage={registerScrollToMessage}
              shouldFollowOutput={shouldFollowOutput}
            initialTopMostItemIndex={(() => {
              const msgs = liveMessages;
              const idx = [...msgs].map((m)=>m.role).lastIndexOf('user');
              return idx >= 0 ? idx : undefined as any;
            })()}
            />
            {/* managedEndRef 已由组件内部渲染，无需此处额外 div */}
          </div>
          {/* 新消息指示器 - 用户查看历史消息时有新消息到达 */}
          <NewMessageIndicator
            show={hasNewMessageWhileAway && !isInputAreaHovered}
            onClick={handleScrollToBottom}
          />
          
          {/* 回到底部按钮 - 用户向上滚动时显示 */}
          {/* <ScrollToBottomButton 
            show={showScrollToBottom && !hasNewMessageWhileAway && !isInputAreaHovered}
            onClick={handleScrollToBottom}
          /> */}
          
          {/* 工具栏 - 超过3条消息时显示，且不在输入框区域时显示 */}
          <div 
            className={`fixed right-6 md:right-8 bottom-38 md:bottom-48 z-40 transition-opacity duration-300 ${
              isInputAreaHovered ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
          >
            <ChatToolbar
              messages={currentConversation.messages as Message[]}
              onNavigateToMessage={navigateToMessage}
              onScrollToTop={handleScrollToTop}
              onScrollToBottom={handleScrollToBottom}
            />
          </div>
          <div 
            className="px-4 py-2 bg-transparent"
            onMouseEnter={() => setIsInputAreaHovered(true)}
            onMouseLeave={() => setIsInputAreaHovered(false)}
          >
            <div className="mx-auto w-full">
            <ChatInput
              isLoading={isLoading}
              onSendMessage={handleSendMessage}
              onStopGeneration={handleStopGeneration}
              onImageUpload={handleImageUpload}
              onFileUpload={handleFileUpload}
              selectedKnowledgeBaseId={selectedKnowledgeBaseId || undefined}
              tokenCount={tokenCount}
              editingMessage={editingMessage}
              onCancelEdit={handleCancelEdit}
              // 会话参数相关
              providerName={currentProviderName}
              modelId={selectedModelId || undefined}
              modelLabel={allMetadata?.find(p => p.models?.some(m => m.name === selectedModelId))?.models?.find(m => m.name === selectedModelId)?.label}
              onSessionParametersChange={handleSessionParametersChange}
              currentSessionParameters={currentSessionParameters}
              conversationId={currentConversationId}
              onOpenSessionParameters={() => setSessionParametersDialogOpen(true)}
            />
            </div>
          </div>
        </main>
      </div>

      {/* Skills 审批与计划面板（浮动） */}
      <FloatingSkillExecutionPlanPanel />
      <FloatingSkillApprovalPanel />

      {/* 会话参数设置弹窗：统一挂载在页面层（右上角三点菜单/标签条共用） */}
      {currentProviderName && selectedModelId && currentConversationId && (
        <SessionParametersDialog
          open={sessionParametersDialogOpen}
          onOpenChange={setSessionParametersDialogOpen}
          providerName={currentProviderName}
          modelId={selectedModelId}
          modelLabel={allMetadata?.find(p => p.models?.some(m => m.name === selectedModelId))?.models?.find(m => m.name === selectedModelId)?.label}
          conversationId={currentConversationId}
          onParametersChange={handleSessionParametersChange}
          currentParameters={currentSessionParameters}
        />
      )}
    </div>
  );
}