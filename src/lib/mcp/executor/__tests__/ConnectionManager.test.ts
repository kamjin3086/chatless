import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  statuses: {} as Record<string, string>,
  servers: [] as Array<{ name: string; config: unknown; enabled?: boolean }>,
  reconnect: vi.fn(),
}));

vi.mock('@/store/mcpStore', () => ({
  useMcpStore: { getState: () => ({ serverStatuses: mocks.statuses }) },
}));
vi.mock('@tauri-apps/plugin-store', () => ({
  Store: { load: async () => ({ get: async () => mocks.servers }) },
}));
vi.mock('../../ServerManager', () => ({
  serverManager: { reconnect: mocks.reconnect },
}));

import { ensureServerConnected } from '../ConnectionManager';

describe('ensureServerConnected', () => {
  beforeEach(() => {
    mocks.statuses = {};
    mocks.servers = [];
    mocks.reconnect.mockReset();
  });

  it('rejects a disabled server even when a stale connection remains', async () => {
    mocks.statuses = { external: 'connected' };
    mocks.servers = [{ name: 'external', config: {}, enabled: false }];

    await expect(ensureServerConnected('external')).rejects.toThrow('已禁用');
    expect(mocks.reconnect).not.toHaveBeenCalled();
  });

  it('reconnects an enabled server only when it is not connected', async () => {
    mocks.statuses = { external: 'disconnected' };
    mocks.servers = [{ name: 'external', config: { endpoint: 'http://example.test' }, enabled: true }];

    await ensureServerConnected('external');
    expect(mocks.reconnect).toHaveBeenCalledWith('external', { endpoint: 'http://example.test' });
  });
});
