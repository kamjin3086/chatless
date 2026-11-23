import { toast } from '@/components/ui/sonner';
import type { Conversation } from '@/types/chat';
import { historyService } from '@/lib/historyService';
import { downloadService } from '@/lib/utils/downloadService';
import { useLocaleStore } from '@/store/localeStore';

export async function exportConversationMarkdown(currentConversation: Conversation | null, currentConversationId: string | null): Promise<void> {
  const { t } = useLocaleStore.getState();
  if (!currentConversationId || !currentConversation) {
    toast.error(t('conversation.nothingToExport'));
    return;
  }

  try {
    const markdown = await historyService.exportConversation(currentConversationId, 'markdown');
    if (!markdown) {
      toast.error(t('conversation.exportFailed'));
      return;
    }

    const safeTitle = (currentConversation.title || 'chatless-conversation').replace(/[\\/:*?"<>|]/g, '_');
    const fileName = `${safeTitle}.md`;
    const success = await downloadService.downloadMarkdown(fileName, markdown);
    if (success) {
      toast.success(t('conversation.exportSucceeded'));
    }
  } catch {
    toast.error(t('conversation.exportFailed'));
  }
}

