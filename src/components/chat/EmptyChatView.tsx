"use client";

import { ChatHeader } from '@/components/chat/ChatHeader';
import type { ComponentProps } from 'react';
import { ChatInput } from '@/components/chat/ChatInput';
import { ChatEmptyState } from '@/components/chat/ChatEmptyState';
import { useAndroidChatNavigation } from '@/components/chat/androidChatNavigation';
import { starterLayout } from '@/components/chat/starterLayout';
import { cn } from '@/lib/utils';
import { ProviderMetadata } from '@/lib/metadata/types';
import { resolveChatSetupState } from '@/lib/chat/resolveChatSetupState';

interface EmptyChatViewProps {
  allMetadata: ProviderMetadata[];
  selectedModelId: string | null;
  onModelChange: (modelId: string) => void;
  isLoading: boolean;
  llmInitialized: boolean;
  onSendMessage: ComponentProps<typeof ChatInput>['onSendMessage'];
  providerName?: string;
  androidPhotoHandoff?: ComponentProps<typeof ChatInput>['androidPhotoHandoff'];
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
  providerName,
  androidPhotoHandoff,
  onStopGeneration,
  selectedKnowledgeBaseId,
  onImageUpload,
  onFileUpload,
  tokenCount = 0
}) => {
  const setupState = resolveChatSetupState(llmInitialized, allMetadata, selectedModelId);
  const canSend = setupState === 'ready';
  const starter = starterLayout(Boolean(useAndroidChatNavigation()), canSend);

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

      <main className={starter.column}>
        <div className={cn('mx-auto w-full', starter.block)}>
          <ChatEmptyState setupState={setupState} modelPicker={{
            allMetadata, currentModelId: selectedModelId, onModelChange, disabled: isLoading,
          }} />
          <div hidden={!canSend}>
            <ChatInput
              onSendMessage={onSendMessage}
              providerName={providerName}
              modelId={selectedModelId || undefined}
              androidPhotoHandoff={androidPhotoHandoff}
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
