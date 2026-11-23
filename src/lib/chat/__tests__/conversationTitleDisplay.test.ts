import { describe, expect, it } from 'vitest';
import {
  displayConversationTitle,
  NEW_CONVERSATION_TITLE,
} from '@/lib/chat/TitleGenerator';

describe('displayConversationTitle', () => {
  it('translates the stored default title at render time', () => {
    expect(displayConversationTitle(NEW_CONVERSATION_TITLE, 'New chat')).toBe(
      'New chat',
    );
    expect(displayConversationTitle(NEW_CONVERSATION_TITLE, '新对话')).toBe(
      '新对话',
    );
  });

  it('leaves a title the user typed alone, including one that only looks similar', () => {
    expect(displayConversationTitle('Release checklist', 'New chat')).toBe(
      'Release checklist',
    );
    expect(displayConversationTitle('新对话 下午 3:20', 'New chat')).toBe(
      '新对话 下午 3:20',
    );
  });
});
