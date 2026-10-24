import { beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({
  grant: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock('@/lib/tauri/filesystemCommands', () => ({
  grantCallScope: io.grant,
  revokeCallScope: io.revoke,
  setAllowlist: vi.fn(),
}));

async function load() {
  return await import('../backendSync');
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
  io.revoke.mockResolvedValue({ ok: true });
});

describe('grantCallScopedPaths', () => {
  it('returns a revoker for the whole scope when every registration succeeds', async () => {
    io.grant.mockResolvedValue({ ok: true });
    const { grantCallScopedPaths } = await load();

    const revoke = await grantCallScopedPaths(
      [
        { path: '/fixture/a', permissions: { read: true } },
        { path: '/fixture/b', permissions: { read: true } },
      ],
      { runId: 'run-a', callId: 'call-1' },
    );
    await revoke();

    expect(io.grant).toHaveBeenCalledTimes(2);
    expect(io.revoke).toHaveBeenCalledWith({
      runId: 'run-a',
      callId: 'call-1',
    });
  });

  it('waits for a late registration and revokes the scope after a partial failure', async () => {
    const events: string[] = [];
    let releaseLate!: () => void;
    io.grant.mockImplementation(async ({ path }: { path: string }) => {
      if (path === '/fixture/b') throw new Error('second grant failed');
      events.push('grant-a-start');
      await new Promise<void>((resolve) => {
        releaseLate = resolve;
      });
      events.push('grant-a-resolved');
      return { ok: true };
    });
    io.revoke.mockImplementation(async () => {
      events.push('revoke');
      return { ok: true };
    });
    const { grantCallScopedPaths } = await load();

    const pending = grantCallScopedPaths(
      [
        { path: '/fixture/a', permissions: { read: true } },
        { path: '/fixture/b', permissions: { read: true } },
      ],
      { runId: 'run-a', callId: 'call-1' },
    );
    await vi.waitFor(() => expect(releaseLate).toBeDefined());

    let rejected = false;
    pending.catch(() => {
      rejected = true;
    });
    // The failure is known, but cleanup must wait for the still-pending grant
    // so the revoker cannot race its successful registration.
    await Promise.resolve();
    expect(rejected).toBe(false);
    expect(io.revoke).not.toHaveBeenCalled();

    releaseLate();
    await expect(pending).rejects.toThrow('second grant failed');
    expect(io.revoke).toHaveBeenCalledWith({
      runId: 'run-a',
      callId: 'call-1',
    });
    expect(events).toEqual(['grant-a-start', 'grant-a-resolved', 'revoke']);
  });

  it('fails a call whose registration never answers and revokes a late success', async () => {
    vi.useFakeTimers();
    try {
      let releaseLate!: () => void;
      io.grant.mockImplementation(
        () =>
          new Promise((resolve) => {
            releaseLate = () => resolve({ ok: true });
          }),
      );
      const { grantCallScopedPaths } = await load();

      const pending = grantCallScopedPaths(
        [{ path: '/fixture/slow', permissions: { read: true } }],
        { runId: 'run-a', callId: 'call-1' },
      );
      pending.catch(() => {});
      await vi.advanceTimersByTimeAsync(20_000);

      await expect(pending).rejects.toThrow(/timed out/);
      expect(io.revoke).toHaveBeenCalledTimes(1);

      // The registration still lands later; it must not outlive the failure.
      releaseLate();
      await vi.advanceTimersByTimeAsync(0);
      expect(io.revoke).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not call the backend when there is nothing to grant', async () => {
    const { grantCallScopedPaths } = await load();
    const revoke = await grantCallScopedPaths([], { runId: 'run-a' });
    await revoke();
    expect(io.grant).not.toHaveBeenCalled();
    expect(io.revoke).not.toHaveBeenCalled();
  });
});
