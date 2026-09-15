import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatInput } from '@/components/chat/ChatInput';
import { ChatEmptyState } from '@/components/chat/ChatEmptyState';
import { ProviderMetadata } from '@/lib/metadata/types';
import { resolveChatSetupState } from '@/lib/chat/resolveChatSetupState';

interface EmptyChatViewProps {
  allMetadata: ProviderMetadata[];
  selectedModelId: string | null;
  onModelChange: (modelId: string) => void;
  isLoading: boolean;
  llmInitialized: boolean;
  onSendMessage: (content: string, documentData?: any, knowledgeBase?: any) => Promise<void>;
  onStopGeneration: () => void;
  tokenCount?: number;
  onPromptClick: (prompt: string) => void;
  selectedKnowledgeBaseId?: string;
  onImageUpload: (file: File) => void;
  onFileUpload: (file: File) => void;
}

export const EmptyChatView: React.FC<EmptyChatViewProps> = ({
  allMetadata,
  selectedModelId,
  onModelChange,
  isLoading,
  llmInitialized,
  onSendMessage,
  onStopGeneration,
  onPromptClick,
  selectedKnowledgeBaseId,
  onImageUpload,
  onFileUpload,
  tokenCount = 0
}) => {
  const setupState = resolveChatSetupState(llmInitialized, allMetadata, selectedModelId);
  const canSend = setupState === 'ready';

  return (
    <div className="flex flex-col h-full min-w-0 glass-surface">
      <ChatHeader
        title="AI Chat"
        allMetadata={allMetadata}
        currentModelId={selectedModelId}
        onModelChange={onModelChange}
        isModelSelectorDisabled={isLoading || !llmInitialized}
        onTitleChange={() => {}} 
        onDelete={() => {}} 
        onShare={() => {}}
        onDownload={() => {}}
        tokenCount={tokenCount}
      />

      <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 flex items-center justify-center px-4">
        <ChatEmptyState onPromptClick={onPromptClick} setupState={setupState} />
      </div>

      <ChatInput
        onSendMessage={onSendMessage}
        onImageUpload={onImageUpload}
        onFileUpload={onFileUpload}
        isLoading={isLoading}
        disabled={!canSend}
        onStopGeneration={onStopGeneration}
        selectedKnowledgeBaseId={selectedKnowledgeBaseId}
        tokenCount={tokenCount}
      />
    </div>
  );
};
