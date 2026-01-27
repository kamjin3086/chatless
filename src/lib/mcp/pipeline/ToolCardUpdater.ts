import { useChatStore } from '@/store/chatStore';
import { buildResultPreview } from './ToolInvocation';

export type ToolCardUpdateBase = {
  assistantMessageId: string;
  server: string;
  tool: string;
  cardId: string;
};

export function markPendingAuth(update: ToolCardUpdateBase) {
  useChatStore.getState().dispatchMessageAction(update.assistantMessageId, {
    type: 'TOOL_RESULT',
    server: update.server,
    tool: update.tool,
    ok: false,
    errorMessage: 'pending_auth',
    cardId: update.cardId,
  });
}

export function markSuccess(update: ToolCardUpdateBase, result: unknown) {
  useChatStore.getState().dispatchMessageAction(update.assistantMessageId, {
    type: 'TOOL_RESULT',
    server: update.server,
    tool: update.tool,
    ok: true,
    resultPreview: buildResultPreview(result),
    cardId: update.cardId,
  });
}

export function markError(update: ToolCardUpdateBase, errorMessage: string, schemaHint?: string) {
  useChatStore.getState().dispatchMessageAction(update.assistantMessageId, {
    type: 'TOOL_RESULT',
    server: update.server,
    tool: update.tool,
    ok: false,
    errorMessage,
    schemaHint,
    cardId: update.cardId,
  });
}

