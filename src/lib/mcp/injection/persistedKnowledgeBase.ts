export interface PersistedKnowledgeBaseReference {
  id: string;
  name: string;
}

/** Resolve the latest persisted user selection for a conversation. */
export async function getPersistedKnowledgeBaseReference(
  conversationId: string,
): Promise<PersistedKnowledgeBaseReference | undefined> {
  if (!conversationId) return undefined;

  try {
    const { useChatStore } = await import('@/store/chatStore');
    const conversation = useChatStore.getState().conversations.find(
      (item: any) => item.id === conversationId,
    );
    const latestUserMessage = [...(conversation?.messages || [])]
      .reverse()
      .find((message: any) => message?.role === 'user');
    const raw = latestUserMessage?.knowledge_base_reference;
    const reference = typeof raw === 'string' ? JSON.parse(raw) : raw;

    if (!reference || typeof reference !== 'object' || Array.isArray(reference) || !reference.id) {
      return undefined;
    }

    return {
      id: String(reference.id),
      name: String(reference.name || reference.id),
    };
  } catch {
    return undefined;
  }
}
