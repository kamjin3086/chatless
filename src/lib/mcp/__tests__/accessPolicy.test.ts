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
  resolveAccess,
  setConversationAccess,
  clearConversationAccess,
  setGlobalAccess,
  getGlobalAccess,
} = await import('../accessPolicy');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.shouldAutoAuthorize.mockResolvedValue(false);
  for (const scope of ['fs', 'shell'] as const) {
    clearConversationAccess(scope, 'conv-1');
    clearConversationAccess(scope, 'conv-2');
  }
});

describe('capability access policy', () => {
  it('asks by default for both filesystem and shell', async () => {
    await expect(resolveAccess('fs', 'conv-1')).resolves.toBe('ask');
    await expect(resolveAccess('shell', 'conv-1')).resolves.toBe('ask');
  });

  it('scopes a session grant to its conversation and capability', async () => {
    setConversationAccess('shell', 'conv-1', 'unrestricted');

    await expect(resolveAccess('shell', 'conv-1')).resolves.toBe('unrestricted');
    // Neither another conversation nor the filesystem capability is affected.
    await expect(resolveAccess('shell', 'conv-2')).resolves.toBe('ask');
    await expect(resolveAccess('fs', 'conv-1')).resolves.toBe('ask');
    expect(mocks.setServerAutoAuthorize).not.toHaveBeenCalled();
  });

  it('can go back to asking', async () => {
    setConversationAccess('fs', 'conv-1', 'unrestricted');
    setConversationAccess('fs', 'conv-1', 'ask');

    await expect(resolveAccess('fs', 'conv-1')).resolves.toBe('ask');
  });

  it('persists the global switch through the per-server authorization config', async () => {
    await setGlobalAccess('shell', 'unrestricted');
    expect(mocks.setServerAutoAuthorize).toHaveBeenCalledWith('shell', true);

    mocks.shouldAutoAuthorize.mockResolvedValue(true);
    await expect(getGlobalAccess('shell')).resolves.toBe('unrestricted');
    await expect(resolveAccess('shell', 'conv-2')).resolves.toBe('unrestricted');

    await setGlobalAccess('shell', 'ask');
    expect(mocks.setServerAutoAuthorize).toHaveBeenLastCalledWith('shell', false);
  });
});
