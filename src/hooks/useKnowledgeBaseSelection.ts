import { useEffect, useRef, useState } from 'react';
import { KnowledgeService, type KnowledgeBase } from '@/lib/knowledgeService';
import { useConversationAttachmentStore } from '@/store/conversationAttachmentStore';

type Selection = { id: string; conversationId: string | null };

/** A URL selection is a one-shot intent for its destination, not a default for
 * every conversation subsequently opened in the same mounted composer.
 */
export function useKnowledgeBaseSelection({
  conversationId,
  deepLinkId,
  deepLinkConversationId,
  consumeDeepLink,
  ready = true,
}: {
  conversationId: string | null;
  deepLinkId?: string;
  deepLinkConversationId?: string;
  consumeDeepLink: () => void;
  ready?: boolean;
}) {
  const [selectedKnowledgeBase, setSelectedKnowledgeBase] =
    useState<KnowledgeBase | null>(null);
  const [intent, setIntent] = useState<Selection | null>(null);
  const claimedLink = useRef<string | undefined>(undefined);
  const mountedId = useConversationAttachmentStore((state) =>
    conversationId
      ? state.knowledgeBaseByConversation[conversationId]?.id
      : undefined,
  );

  useEffect(() => {
    if (!ready) return;
    if (!deepLinkId) {
      claimedLink.current = undefined;
      return;
    }
    // ChatPage may still be switching from the previous conversation to the
    // URL destination. Do not bind that destination's selection to the old one.
    if (deepLinkConversationId && deepLinkConversationId !== conversationId)
      return;
    const key = `${deepLinkConversationId || ''}\u0000${deepLinkId}`;
    if (claimedLink.current === key) return;
    claimedLink.current = key;
    setIntent({ id: deepLinkId, conversationId });
    consumeDeepLink();
  }, [
    conversationId,
    deepLinkId,
    deepLinkConversationId,
    consumeDeepLink,
    ready,
  ]);

  const activeIntent =
    intent?.conversationId === conversationId ? intent : null;
  const id = activeIntent?.id || mountedId;
  useEffect(() => {
    let cancelled = false;
    setSelectedKnowledgeBase(null);
    if (id) {
      void KnowledgeService.getKnowledgeBase(id)
        .then((kb) => {
          if (cancelled) return;
          setSelectedKnowledgeBase(kb || null);
          if (activeIntent && conversationId) {
            const attachments = useConversationAttachmentStore.getState();
            if (kb)
              attachments.setKnowledgeBase(conversationId, {
                id: kb.id,
                name: kb.name,
              });
            else attachments.clearKnowledgeBase(conversationId);
            setIntent(null);
          } else if (!kb && conversationId) {
            const attachments = useConversationAttachmentStore.getState();
            if (
              attachments.knowledgeBaseByConversation[conversationId]?.id === id
            )
              attachments.clearKnowledgeBase(conversationId);
          }
        })
        .catch((error) => {
          if (!cancelled)
            console.error('Failed to load knowledge base:', error);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [conversationId, id, activeIntent]);

  const selectKnowledgeBase = (kb: KnowledgeBase) => {
    setSelectedKnowledgeBase(kb);
    if (conversationId) {
      setIntent(null);
      useConversationAttachmentStore
        .getState()
        .setKnowledgeBase(conversationId, { id: kb.id, name: kb.name });
    } else {
      // Keep an unsent draft's selection even after its URL has been consumed.
      setIntent({ id: kb.id, conversationId: null });
    }
  };

  const removeSelectedKnowledgeBase = () => {
    setIntent(null);
    setSelectedKnowledgeBase(null);
    if (conversationId)
      useConversationAttachmentStore
        .getState()
        .clearKnowledgeBase(conversationId);
    consumeDeepLink();
  };

  return {
    selectedKnowledgeBase,
    selectKnowledgeBase,
    removeSelectedKnowledgeBase,
  };
}
