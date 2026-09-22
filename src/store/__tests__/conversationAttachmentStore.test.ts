import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureAllowlistedDirectory: vi.fn(async () => {}),
}));

vi.mock('@/lib/filesystemAllowlist', () => ({
  ensureAllowlistedDirectory: mocks.ensureAllowlistedDirectory,
}));

import { useConversationAttachmentStore } from '../conversationAttachmentStore';

const CONVERSATION = 'conv-1';

beforeEach(() => {
  mocks.ensureAllowlistedDirectory.mockClear();
  useConversationAttachmentStore.setState({
    sessionDirByConversation: {},
    mountedDirByConversation: {},
    knowledgeBaseByConversation: {},
  } as never);
});

describe('@WorkDir resolution', () => {
  it('uses the session folder when nothing is attached', () => {
    const store = useConversationAttachmentStore.getState();
    store.setWorkingDir(CONVERSATION, 'C:/Users/x/Documents/Chatless/线缆整改-3f9a21');
    expect(useConversationAttachmentStore.getState().getWorkingDir(CONVERSATION))
      .toBe('C:/Users/x/Documents/Chatless/线缆整改-3f9a21');
  });

  it('lets an attached directory become @WorkDir, and restores the session folder on detach', () => {
    const store = useConversationAttachmentStore.getState();
    store.setWorkingDir(CONVERSATION, 'C:/Users/x/Documents/Chatless/线缆整改-3f9a21');
    store.setMountedDir(CONVERSATION, 'D:/projects/site');

    expect(useConversationAttachmentStore.getState().getWorkingDir(CONVERSATION)).toBe('D:/projects/site');
    expect(useConversationAttachmentStore.getState().getSessionDir(CONVERSATION))
      .toBe('C:/Users/x/Documents/Chatless/线缆整改-3f9a21');

    useConversationAttachmentStore.getState().clearMountedDir(CONVERSATION);
    expect(useConversationAttachmentStore.getState().getWorkingDir(CONVERSATION))
      .toBe('C:/Users/x/Documents/Chatless/线缆整改-3f9a21');
  });

  it('never persists the session folder into the filesystem allowlist', () => {
    // One permanent entry per conversation is what made the security settings
    // unauditable; the session folder is authorized per call instead.
    useConversationAttachmentStore.getState().setWorkingDir(CONVERSATION, 'C:/Users/x/Documents/Chatless/a-3f9a21');
    expect(mocks.ensureAllowlistedDirectory).not.toHaveBeenCalled();
  });

  it('still persists a directory the user attached themselves', () => {
    useConversationAttachmentStore.getState().setMountedDir(CONVERSATION, 'D:/projects/site');
    expect(mocks.ensureAllowlistedDirectory).toHaveBeenCalledTimes(1);
    expect(mocks.ensureAllowlistedDirectory).toHaveBeenCalledWith(expect.objectContaining({
      path: 'D:/projects/site',
      source: 'attachment',
    }));
  });
});
