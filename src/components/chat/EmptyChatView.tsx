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
        title="Chatless"
        allMetadata={allMetadata}
        currentModelId={selectedModelId}
        onModelChange={onModelChange}
        isModelSelectorDisabled={isLoading || !llmInitialized}
        hideModelSelector={!canSend}
        onTitleChange={() => {}} 
        onDelete={() => {}} 
        onShare={() => {}}
        onDownload={() => {}}
        tokenCount={tokenCount}
      />

      <main className="flex min-h-0 flex-1 flex-col justify-center-safe overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl py-6">
          <ChatEmptyState setupState={setupState} modelPicker={{
            allMetadata, currentModelId: selectedModelId, onModelChange, disabled: isLoading,
          }} />
          <div hidden={!canSend}>
            <ChatInput
              onSendMessage={onSendMessage}
              onImageUpload={onImageUpload}
              onFileUpload={onFileUpload}
              isLoading={isLoading}
              disabled={!canSend}
              onStopGeneration={onStopGeneration}
              selectedKnowledgeBaseId={selectedKnowledgeBaseId}
              tokenCount={tokenCount}
              showStarterActions
            />
          </div>
        </div>
      </main>
    </div>
  );
};
