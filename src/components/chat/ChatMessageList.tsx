import React from 'react';
import { Virtuoso } from 'react-virtuoso';
import { ChatMessage } from './ChatMessage';
import { VersionedAssistantGroup } from './VersionedAssistantGroup';
import { Message } from '@/types/chat';
import { ChatEmptyState } from '@/components/chat/ChatEmptyState';
import FoldingLoader from '@/components/ui/FoldingLoader';

interface ChatMessageListProps {
  chatId?: string;
  messages: Message[];
  isLoading: boolean;
  onEditMessage: (messageId: string, content: string) => void;
  /** 重新生成（刷新）助手消息 */
  onRetryMessage?: (messageId: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onSaveThinkingDuration?: (messageId: string, duration: number) => void;
  messageRefs?: React.MutableRefObject<{ [key: string]: HTMLDivElement }>;
  messagesEndRef?: React.RefObject<HTMLDivElement | null>;
  /** 外部滚动容器（推荐传入父级滚动容器） */
  scrollParentRef?: React.RefObject<HTMLDivElement | null>;
  /** 注册一个按消息ID滚动的API，便于父组件实现"跳转到具体消息" */
  onRegisterScrollToMessage?: (fn: (id: string) => void) => void;
  /** 首次挂载时的初始可视区域顶端索引（用于快速定位） */
  initialTopMostItemIndex?: number;
  /** 是否应该自动滚动到底部（由父组件的滚动管理逻辑控制） */
  shouldFollowOutput?: boolean;
}

export function ChatMessageList({
  chatId: _chatId,
  messages,
  isLoading,
  onEditMessage,
  onRetryMessage,
  onDeleteMessage: _onDeleteMessage,
  onSaveThinkingDuration,
  messageRefs,
  messagesEndRef,
  scrollParentRef,
  onRegisterScrollToMessage,
  initialTopMostItemIndex,
  shouldFollowOutput = false,
}: ChatMessageListProps) {

  // 预处理：将版本化消息分组，生成渲染项
  const renderItems = React.useMemo(() => {
    const items: Array<{ type: 'single' | 'group'; message: Message; versions?: Message[] }> = [];
    const processedIds = new Set<string>();
    const processedGroups = new Set<string>();

    for (const msg of messages) {
      if (processedIds.has(msg.id)) continue;

      const isAssistant = msg.role === 'assistant';
      const groupId = (msg as any).version_group_id as string | undefined;

      if (isAssistant && groupId) {
        // 如果这个组已经处理过，跳过
        if (processedGroups.has(groupId)) {
          processedIds.add(msg.id);
          continue;
        }

        // 找出同组的所有版本
        const group = messages.filter((m: any) => 
          m.role === 'assistant' && 
          (m.version_group_id === groupId)
        );
        
        // 按 version_index 排序
        const sorted = [...group].sort((a: any, b: any) => (a.version_index ?? 0) - (b.version_index ?? 0));
        
        // 添加整个版本组（用第一个版本的位置）
        items.push({ type: 'group', message: sorted[0], versions: sorted });
        
        // 标记整个组为已处理
        processedGroups.add(groupId);
        group.forEach(v => processedIds.add(v.id));
      } else {
        // 非版本化消息或用户消息
        items.push({ type: 'single', message: msg });
        processedIds.add(msg.id);
      }
    }

    return items;
  }, [messages]);

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <ChatEmptyState onPromptClick={() => {}} />
      </div>
    );
  }

  return (
    <div className="flex-1 custom-scrollbar" style={{ overscrollBehavior: 'contain' }}>
      <Virtuoso
        totalCount={renderItems.length}
        data={renderItems}
        useWindowScroll={false}
        customScrollParent={scrollParentRef?.current || undefined}
        increaseViewportBy={400}
        followOutput={shouldFollowOutput ? 'auto' : false}
        alignToBottom={shouldFollowOutput}
        initialTopMostItemIndex={typeof initialTopMostItemIndex === 'number' ? initialTopMostItemIndex : undefined}
        computeItemKey={(index, item) => item.type === 'group' ? `group-${(item.message as any).version_group_id}` : item.message.id}
        itemContent={(index: number, item: typeof renderItems[0]) => {
          const message = item.message;

          if (item.type === 'group' && item.versions) {
            const groupId = (message as any).version_group_id;
            return (
              <div
                key={`group-${groupId}`}
                ref={(el) => {
                  if (messageRefs) {
                    if (el) messageRefs.current[message.id] = el; else delete messageRefs.current[message.id];
                  }
                }}
                className='ml-4 mr-2'
                style={{ contain: 'layout paint', transform: 'translateZ(0)' }}
              >
                <VersionedAssistantGroup
                  versions={item.versions}
                  onEditMessage={onEditMessage}
                  onRetryMessage={onRetryMessage}
                  onSaveThinkingDuration={onSaveThinkingDuration}
                />
              </div>
            );
          }

          // 非版本化或 user 消息按原方式渲染
          return (
            <div
              key={message.id}
              ref={(el) => {
                if (messageRefs) {
                  if (el) messageRefs.current[message.id] = el; else delete messageRefs.current[message.id];
                }
              }}
              data-message-id={message.id}
              className='ml-4 mr-2'
              style={{ minHeight: 56, contain: 'layout paint', transform: 'translateZ(0)' }}
            >
              <ChatMessage
                id={message.id}
                content={message.content}
                role={message.role}
                timestamp={new Date(message.created_at).toISOString()}
                model={message.model}
                status={((): any => {
                  const isLast = messages[messages.length - 1]?.id === message.id;
                  const s = message.status;
                  if (!isLast && s === 'loading') return 'sent';
                  if (isLast) return s || (isLoading ? 'loading' : 'sent');
                  return s || 'sent';
                })()}
                thinking_duration={message.thinking_duration}
                onSaveThinkingDuration={onSaveThinkingDuration}
                documentReference={message.document_reference}
                knowledgeBaseReference={message.knowledge_base_reference}
                images={message.images}
                viewModel={message.segments_vm}
                segments={message.segments}
                onEdit={() => onEditMessage(message.id, message.content)}
                onCopy={(content) => navigator.clipboard.writeText(content)}
                onRetry={message.role === 'assistant' && onRetryMessage ? () => onRetryMessage(message.id) : undefined}
              />
            </div>
          );
        }}
        components={{
          Footer: () => (messagesEndRef ? <div ref={messagesEndRef} /> : null),
        }}
        style={{ height: '100%' }}
        ref={(instance) => {
          if (!onRegisterScrollToMessage || !instance) return;
          // 以 any 访问可能存在的 scrollToIndex 方法
          const anyInst: any = instance;
          const api = (id: string) => {
            // 在 renderItems 中查找对应的索引
            const idx = renderItems.findIndex((item) => {
              if (item.type === 'single') {
                return item.message.id === id;
              } else if (item.type === 'group' && item.versions) {
                // 如果是版本组，检查该组中是否包含目标消息
                return item.versions.some(v => v.id === id);
              }
              return false;
            });
            if (idx >= 0 && typeof anyInst.scrollToIndex === 'function') {
              anyInst.scrollToIndex({ index: idx, align: 'start', behavior: 'auto' });
            }
          };
          onRegisterScrollToMessage(api);
        }}
      />
      {isLoading && messages.length === 0 && (
        <div className="flex justify-center p-4">
          <FoldingLoader size={36} />
        </div>
      )}
    </div>
  );
} 