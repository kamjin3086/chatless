import { translate } from '@/i18n';
import type { Locale } from '@/i18n/types';
import type { KnowledgeBase } from '@/lib/knowledgeService';

export interface MenuItem {
  id: string;
  text: string;
  action?: () => void;
  separator?: boolean;
  enabled?: boolean;
}

export function createKnowledgeMenuItems(
  kb: KnowledgeBase,
  locale: Locale,
  options: {
    onRename?: (kb: KnowledgeBase) => void;
    onEditDesc?: (kb: KnowledgeBase) => void;
    onDelete?: (kb: KnowledgeBase) => void;
  }
): MenuItem[] {
  const { onRename, onEditDesc, onDelete } = options;
  return [
    { id: 'rename', text: translate(locale, 'knowledge.rename'), action: () => onRename?.(kb) },
    { id: 'editDesc', text: translate(locale, 'knowledge.editDescription'), action: () => onEditDesc?.(kb) ?? onRename?.(kb) },
    { id: 'separator', text: '', separator: true },
    { id: 'delete', text: translate(locale, 'knowledge.delete'), action: () => onDelete?.(kb) }
  ];
} 