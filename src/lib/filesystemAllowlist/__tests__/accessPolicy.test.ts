import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  shouldAutoAuthorize: vi.fn(async () => false),
  setServerAutoAuthorize: vi.fn(async () => {}),
}));

vi.mock('@/lib/mcp/authorizationConfig', () => ({
  shouldAutoAuthorize: mocks.shouldAutoAuthorize,
  setServerAutoAuthorize: mocks.setServerAutoAuthorize,
}));

const {
  resolveFilesystemAccess,
  setConversationFilesystemAccess,
  clearConversationFilesystemAccess,
  setGlobalFilesystemAccess,
  getGlobalFilesystemAccess,
} = await import('../accessPolicy');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.shouldAutoAuthorize.mockResolvedValue(false);
  clearConversationFilesystemAccess('conv-1');
  clearConversationFilesystemAccess('conv-2');
});

describe('filesystem access policy', () => {
  it('asks by default', async () => {
    await expect(resolveFilesystemAccess('conv-1')).resolves.toBe('ask');
  });

  it('lets one conversation stop asking without touching the global setting', async () => {
    setConversationFilesystemAccess('conv-1', 'unrestricted');

    await expect(resolveFilesystemAccess('conv-1')).resolves.toBe('unrestricted');
    // Another conversation is unaffected.
    await expect(resolveFilesystemAccess('conv-2')).resolves.toBe('ask');
    expect(mocks.setServerAutoAuthorize).not.toHaveBeenCalled();
  });

  it('turns a conversation back to asking', async () => {
    setConversationFilesystemAccess('conv-1', 'unrestricted');
    setConversationFilesystemAccess('conv-1', 'ask');

    await expect(resolveFilesystemAccess('conv-1')).resolves.toBe('ask');
  });

  it('persists the global switch through the per-server authorization config', async () => {
    await setGlobalFilesystemAccess('unrestricted');
    expect(mocks.setServerAutoAuthorize).toHaveBeenCalledWith('fs', true);

    mocks.shouldAutoAuthorize.mockResolvedValue(true);
    await expect(getGlobalFilesystemAccess()).resolves.toBe('unrestricted');
    await expect(resolveFilesystemAccess('conv-2')).resolves.toBe('unrestricted');

    await setGlobalFilesystemAccess('ask');
    expect(mocks.setServerAutoAuthorize).toHaveBeenLastCalledWith('fs', false);
  });
});
