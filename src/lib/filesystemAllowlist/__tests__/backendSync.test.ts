import { beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({
  grant: vi.fn(),
  revoke: vi.fn(),
  sync: vi.fn(),
}));

vi.mock('@/lib/tauri/filesystemCommands', () => ({
  grantCallScope: io.grant,
  revokeCallScope: io.revoke,
  setAllowlist: io.sync,
}));

const dir = (path: string) => ({
  id: `dir:${path}`,
  path,
  source: 'manual' as const,
  createdAt: 1,
  updatedAt: 1,
  permissions: { read: true, write: false, create: false, delete: false },
});

async function load() {
  return await import('../backendSync');
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
  io.revoke.mockResolvedValue({ ok: true });
  io.sync.mockResolvedValue({ ok: true });
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

  it('does not call the backend when there is nothing to grant', async () => {
    const { grantCallScopedPaths } = await load();
    const revoke = await grantCallScopedPaths([], { runId: 'run-a' });
    await revoke();
    expect(io.grant).not.toHaveBeenCalled();
    expect(io.revoke).not.toHaveBeenCalled();
  });
});

describe('syncFilesystemAllowlistToBackend', () => {
  it('retries an identical allowlist after a failed delivery', async () => {
    io.sync
      .mockRejectedValueOnce(new Error('command not delivered'))
      .mockResolvedValueOnce({ ok: true });
    const { syncFilesystemAllowlistToBackend } = await load();

    await expect(
      syncFilesystemAllowlistToBackend([dir('/fixture/retry')]),
    ).rejects.toThrow('command not delivered');
    await syncFilesystemAllowlistToBackend([dir('/fixture/retry')]);

    expect(io.sync).toHaveBeenCalledTimes(2);
  });

  it('deduplicates an acknowledged allowlist', async () => {
    const { syncFilesystemAllowlistToBackend } = await load();
    await syncFilesystemAllowlistToBackend([dir('/fixture/same')]);
    await syncFilesystemAllowlistToBackend([dir('/fixture/same')]);
    expect(io.sync).toHaveBeenCalledTimes(1);
  });

  it('serializes overlapping updates so the last requested state is acknowledged last', async () => {
    let releaseFirst!: () => void;
    io.sync
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = () => resolve({ ok: true });
          }),
      )
      .mockResolvedValue({ ok: true });
    const { syncFilesystemAllowlistToBackend } = await load();

    const first = syncFilesystemAllowlistToBackend([dir('/fixture/one')]);
    const second = syncFilesystemAllowlistToBackend([dir('/fixture/two')]);
    await vi.waitFor(() => expect(io.sync).toHaveBeenCalledTimes(1));
    releaseFirst();
    await Promise.all([first, second]);

    expect(io.sync).toHaveBeenCalledTimes(2);
    expect(io.sync.mock.calls[1][0].directories[0].path).toBe('/fixture/two');
  });

  it('a newer successful update is not undone by an earlier failure', async () => {
    io.sync
      .mockRejectedValueOnce(new Error('first failed'))
      .mockResolvedValueOnce({ ok: true });
    const { syncFilesystemAllowlistToBackend } = await load();

    const first = syncFilesystemAllowlistToBackend([dir('/fixture/old')]);
    const second = syncFilesystemAllowlistToBackend([dir('/fixture/new')]);
    await expect(first).rejects.toThrow('first failed');
    await second;

    // The old state was never acknowledged, so asking for it again must reach
    // the backend rather than be skipped by the cache.
    io.sync.mockResolvedValueOnce({ ok: true });
    await syncFilesystemAllowlistToBackend([dir('/fixture/old')]);
    expect(io.sync).toHaveBeenCalledTimes(3);
    expect(io.sync.mock.calls[2][0].directories[0].path).toBe('/fixture/old');
  });
});
