import { beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({
  grant: vi.fn(async () => ({ ok: true })),
  revoke: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/tauri/filesystemCommands', () => ({
  grantCallScope: io.grant,
  revokeCallScope: io.revoke,
}));

import { withOneShotGrant } from '../oneShotGrant';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('withOneShotGrant', () => {
  it('hands the registered identity to the command and revokes the same scope', async () => {
    const seen = await withOneShotGrant(
      { path: '/fixture/a.txt', scope: 'open', read: true },
      async (scope) => scope,
    );

    const registered = (
      io.grant.mock.calls[0] as unknown as [{ runId: string; callId: string }]
    )[0];
    expect(seen).toEqual({
      runId: registered.runId,
      callId: registered.callId,
    });
    expect(io.revoke).toHaveBeenCalledWith({
      runId: seen.runId,
      callId: seen.callId,
    });
  });

  it('revokes the registration when the command fails', async () => {
    await expect(
      withOneShotGrant(
        { path: '/fixture/a.txt', scope: 'open', read: true },
        async () => {
          throw new Error('command failed');
        },
      ),
    ).rejects.toThrow('command failed');
    expect(io.revoke).toHaveBeenCalledTimes(1);
  });
});
