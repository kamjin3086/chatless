import { describe, expect, it } from 'vitest';
import type { Conversation } from '@/types/chat';
import {
  conversationSidebarRows,
  type ConversationSidebarRow,
} from '../conversationGroups';

const now = new Date(2026, 10, 19, 12);
function chat(id: string, daysAgo: number, hour = 8): Conversation {
  const time = new Date(2026, 10, 19 - daysAgo, hour).getTime();
  return {
    id,
    title: id,
    model_id: 'test',
    created_at: time,
    updated_at: time,
    messages: [],
    is_favorite: false,
  };
}
const keys = (rows: ConversationSidebarRow[]) => rows.map((row) => row.key);

describe('conversation sidebar groups', () => {
  it('uses local calendar days and partitions conversations into non-overlapping time ranges', () => {
    const conversations = [
      chat('old', 30),
      chat('six', 6),
      chat('yesterday', 1, 23),
      chat('today', 0, 0),
      chat('seven', 7),
      chat('twenty-nine', 29),
    ];
    expect(
      keys(conversationSidebarRows(conversations, 'time', {}, now)),
    ).toEqual([
      'time:today',
      'conversation:today',
      'time:yesterday',
      'conversation:yesterday',
      'time:last7Days',
      'conversation:six',
      'time:last30Days',
      'conversation:seven',
      'conversation:twenty-nine',
      'time:older',
      'conversation:old',
    ]);
  });

  it('keeps same-named directories separate, merges separator variants, and keeps unmounted chats together', () => {
    const conversations = [
      chat('first', 0),
      chat('second', 1),
      chat('third', 2),
      chat('fourth', 3),
      chat('fifth', 4),
    ];
    const mounts = {
      first: 'D:\\work\\site\\',
      second: 'C:/work/site',
      fourth: 'D:/work/site',
    };
    expect(
      keys(conversationSidebarRows(conversations, 'workspace', mounts, now)),
    ).toEqual([
      'workspace:path:D:/work/site',
      'conversation:first',
      'conversation:fourth',
      'workspace:path:C:/work/site',
      'conversation:second',
      'workspace:default',
      'conversation:third',
      'conversation:fifth',
    ]);
  });

  it('keeps opened directories even when empty and collapses only the requested group', () => {
    const rows = conversationSidebarRows(
      [chat('active', 0), chat('other', 1)],
      'workspace',
      { active: '/work/current' },
      now,
      ['/work/empty'],
      new Set(['/work/current']),
    );
    expect(keys(rows)).toEqual([
      'workspace:path:/work/empty',
      'workspace:path:/work/current',
      'workspace:default',
      'conversation:other',
    ]);
  });

  it('does not emit empty groups after filtering', () => {
    expect(conversationSidebarRows([], 'time', {}, now)).toEqual([]);
    expect(
      keys(conversationSidebarRows([chat('found', 1)], 'workspace', {}, now)),
    ).toEqual(['workspace:default', 'conversation:found']);
  });
});
