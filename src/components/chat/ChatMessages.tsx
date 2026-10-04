import { useMemo } from 'react';
import { ChatMessage as ChatMessageComponent } from '@/components/chat/ChatMessage';
import { ChatEmptyState } from '@/components/chat/ChatEmptyState';
import type { Message as OriginalMessage, Conversation } from '@/types/chat';
import { v4 as uuidv4 } from 'uuid';

// This interface should ideally be moved to a central types file (e.g., src/types/chat.ts)
// For now, we define it here to match the logic from page.tsx
interface ChatMessage extends OriginalMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
  updated_at: number;
  status: 'pending' | 'sending' | 'sent' | 'error' | 'loading' | 'aborted';
  model?: string;
  thinking_start_time?: number;
  thinking_duration?: number;
  document_reference?: {
    fileName: string;
    fileType: string;
    fileSize: number;
    summary: string;
  };
  context_data?: string;
  knowledge_base_reference?: {
    id: string;
    name: string;
  };
}

interface ChatMessagesProps {
  conversation: Conversation | null;
  messageRefs: React.MutableRefObject<{ [key: string]: HTMLDivElement }>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  maxVisibleMessages: number;
  onRetry: (messageId: string) => void;
  onSaveThinkingDuration: (messageId: string, duration: number) => void;
  onEmptyStatePromptClick: (prompt: string) => void;
}

export const ChatMessages: React.FC<ChatMessagesProps> = ({
  conversation,
  messageRefs,
  messagesEndRef,
  maxVisibleMessages,
  onRetry,
  onSaveThinkingDuration,
  onEmptyStatePromptClick,
}) => {
  const visibleMessages = useMemo(() => {
    if (!conversation?.messages) return [];
    
    if (conversation.messages.length > maxVisibleMessages && 
        !conversation.messages.some(m => m.status === 'loading')) {
      return conversation.messages.slice(-maxVisibleMessages);
    }
    return conversation.messages;
  }, [conversation?.messages, maxVisibleMessages]);

  const handleEditMessage = (_id: string) => {};
  const handleCopyMessage = (content: string) => navigator.clipboard.writeText(content);
  const handleStarMessage = (_id: string) => {};

  const processedMessages = useMemo(() => {
    if (!visibleMessages) return [];
    return visibleMessages.map((msg): ChatMessage => ({
      id: msg.id || uuidv4(),
      conversation_id: msg.conversation_id || conversation?.id || '',
      role: msg.role,
      content: msg.content,
      created_at: msg.created_at || Date.now(),
      updated_at: msg.updated_at || Date.now(),
      status: msg.status || 'sent',
      model: msg.model,
      thinking_duration: msg.thinking_duration,
      thinking_start_time: (msg as any).thinking_start_time,
      document_reference: msg.document_reference,
      context_data: msg.context_data,
      knowledge_base_reference: msg.knowledge_base_reference,
      images: msg.images,
      // 关键：把结构化段透传到渲染层
      segments: (msg as any).segments,
    }));
  }, [visibleMessages, conversation?.id]);

  const messageList = useMemo(() => {
    if (!processedMessages || processedMessages.length === 0) {
        return <ChatEmptyState onPromptClick={onEmptyStatePromptClick} />;
    }

    return (
      <>
        {processedMessages.map((message) => (
          <div
            key={message.id}
            ref={(el) => {
              if (el) messageRefs.current[message.id] = el;
              else delete messageRefs.current[message.id];
            }}
          >
            <ChatMessageComponent
              id={message.id}
              content={message.content || ''}
              role={message.role}
              timestamp={new Date(message.created_at).toISOString()}
              model={message.model}
              status={message.status}
              thinking_duration={message.thinking_duration}
              thinking_start_time={message.thinking_start_time}
              onSaveThinkingDuration={(msgId, duration) => { onSaveThinkingDuration(msgId, duration); }}
              onEdit={handleEditMessage}
              onCopy={(c) => { void handleCopyMessage(c); }}
              onStar={handleStarMessage}
              onRetry={message.role === 'assistant' ? (() => { onRetry(message.id); }) : undefined}
              documentReference={message.document_reference}
              contextData={message.context_data}
              knowledgeBaseReference={message.knowledge_base_reference}
              segments={(message as any).segments}
            />
          </div>
        ))}
      </>
    );
  }, [processedMessages, messageRefs, onRetry, onSaveThinkingDuration, onEmptyStatePromptClick]);

  return (
    <div className="w-full max-w-full min-w-0 flex flex-col items-stretch">
      <div className="p-4 w-full max-w-full overflow-x-hidden">
        {visibleMessages.length > maxVisibleMessages && (
          <div className="text-center text-sm text-slate-500 my-4">
            仅显示最近 {maxVisibleMessages} 条消息。
          </div>
        )}
        {messageList}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}; 