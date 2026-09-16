import { useChatStore } from '@/store/chatStore';
import { AgentRunControlPlane } from './AgentRunControlPlane';

const chatPlanes = new Map<string, AgentRunControlPlane>();

function isAgentMode(conversationId: string): boolean {
  const conv = useChatStore.getState().conversations.find((c) => c.id === conversationId);
  return conv?.tool_mode === 'agent';
}

export async function ensureChatRunPlane(
  conversationId: string,
  assistantMessageId: string,
): Promise<AgentRunControlPlane | null> {
  if (isAgentMode(conversationId)) return null;
  let plane = chatPlanes.get(assistantMessageId);
  if (!plane) {
    plane = new AgentRunControlPlane(assistantMessageId, conversationId, assistantMessageId);
    await plane.start();
    chatPlanes.set(assistantMessageId, plane);
  }
  return plane;
}

export function dropChatRunPlane(assistantMessageId: string): void {
  chatPlanes.delete(assistantMessageId);
}
