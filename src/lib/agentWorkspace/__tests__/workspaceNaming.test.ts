import { describe, expect, it } from 'vitest';
import {
  sanitizeConversationSlug,
  shortConversationId,
  workspaceFolderName,
} from '../workspaceService';

describe('conversation workspace naming', () => {
  it('keeps a readable title and strips anything a path cannot hold', () => {
    expect(sanitizeConversationSlug('线缆整改 2026')).toBe('线缆整改 2026');
    expect(sanitizeConversationSlug('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j');
    expect(sanitizeConversationSlug('  多余   空白  ')).toBe('多余 空白');
    expect(sanitizeConversationSlug('...trailing dots...')).toBe('trailing dots');
  });

  it('falls back when the title has nothing usable', () => {
    expect(sanitizeConversationSlug('')).toBe('会话');
    expect(sanitizeConversationSlug('   ')).toBe('会话');
    expect(sanitizeConversationSlug('///')).toBe('会话');
    expect(sanitizeConversationSlug('新对话 2026/9/22')).toContain('新对话');
  });

  it('caps the slug so a long title cannot build an unusable path', () => {
    const long = '很长'.repeat(60);
    expect(Array.from(sanitizeConversationSlug(long)).length).toBeLessThanOrEqual(40);
  });

  it('derives a stable short id from the conversation id', () => {
    expect(shortConversationId('3f9a21c4-1234-4abc-9def-000000000000')).toBe('3f9a21');
    expect(shortConversationId('!!!')).toBe('session');
  });

  it('names the folder with the title and the short id', () => {
    const name = workspaceFolderName('线缆整改', '3f9a21c4-1234-4abc-9def-000000000000');
    expect(name).toBe('线缆整改-3f9a21');
    // The short id is what makes an existing folder findable again after the
    // in-memory mapping is lost by a restart.
    expect(name.endsWith('-3f9a21')).toBe(true);
  });
});
