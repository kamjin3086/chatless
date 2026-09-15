import type { ProviderMetadata } from '@/lib/metadata/types';
import type { ChatSetupState } from '@/components/chat/ChatEmptyState';

export function resolveChatSetupState(
  llmInitialized: boolean,
  allMetadata: ProviderMetadata[],
  selectedModelId: string | null
): ChatSetupState {
  if (!llmInitialized) return 'initializing';
  if (!allMetadata || allMetadata.length === 0) return 'no_provider';
  const hasAnyModel = allMetadata.some((p) => Array.isArray(p.models) && p.models.length > 0);
  if (!hasAnyModel || !selectedModelId) return 'no_model';
  return 'ready';
}
