import { beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({
  sync: vi.fn(),
}));

vi.mock('@/lib/tauri/filesystemCommands', () => ({
  grantCallScope: vi.fn(),
  revokeCallScope: vi.fn(),
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
  io.sync.mockResolvedValue({ ok: true });
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

  it('applies a call made while another update is in flight after that update', async () => {
    io.sync.mockResolvedValueOnce({ ok: true });
    const { syncFilesystemAllowlistToBackend } = await load();
    await syncFilesystemAllowlistToBackend([dir('/fixture/a')]);

    let releaseB!: () => void;
    io.sync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseB = () => resolve({ ok: true });
        }),
    );
    const b = syncFilesystemAllowlistToBackend([dir('/fixture/b')]);
    await vi.waitFor(() => expect(io.sync).toHaveBeenCalledTimes(2));

    // A is the last acknowledged state, but it is requested after B started.
    const a = syncFilesystemAllowlistToBackend([dir('/fixture/a')]);
    releaseB();
    await Promise.all([b, a]);

    expect(io.sync).toHaveBeenCalledTimes(3);
    expect(io.sync.mock.calls[2][0].directories[0].path).toBe('/fixture/a');
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
