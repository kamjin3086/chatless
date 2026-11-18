import { beforeEach, expect, it, vi } from 'vitest';
import { grantCallScopedPaths, syncFilesystemAllowlistToBackend } from '@/lib/filesystemAllowlist/backendSync';
const io = vi.hoisted(() => ({ grant: vi.fn(), revoke: vi.fn(), sync: vi.fn() }));
vi.mock('@/lib/tauri/filesystemCommands', () => ({ grantCallScope: io.grant, revokeCallScope: io.revoke, setAllowlist: io.sync }));
beforeEach(() => { vi.resetAllMocks(); io.revoke.mockResolvedValue({ ok: true }); });
it('control: complete registration returns a working revoker', async () => {
  io.grant.mockResolvedValue({ ok: true });
  const revoke = await grantCallScopedPaths([{ path: '/fixture/a', permissions: { read: true } }], { runId: 'A', callId: '1' });
  await revoke();
  expect(io.revoke).toHaveBeenCalledWith({ runId: 'A', callId: '1' });
});
it('rolls back an already installed grant if another registration fails', async () => {
  const installed = new Set<string>();
  io.grant.mockImplementation(async ({ path }) => {
    if (path === '/fixture/b') throw new Error('second grant failed');
    installed.add(path); return { ok: true };
  });
  io.revoke.mockImplementation(async () => { installed.clear(); return { ok: true }; });
  await expect(grantCallScopedPaths([
    { path: '/fixture/a', permissions: { read: true } },
    { path: '/fixture/b', permissions: { read: true } },
  ], { runId: 'A', callId: '1' })).rejects.toThrow('second grant failed');
  console.log('grants left after failed registration:', [...installed], 'revocations:', io.revoke.mock.calls.length);
  expect(installed.size).toBe(0);
});
it('retries an unchanged allowlist after a failed synchronization', async () => {
  io.sync.mockRejectedValueOnce(new Error('command not delivered')).mockResolvedValueOnce({ ok: true });
  const dirs: any = [{ path: '/fixture/retry', permissions: { read: true } }];
  await expect(syncFilesystemAllowlistToBackend(dirs)).rejects.toThrow('command not delivered');
  await syncFilesystemAllowlistToBackend(dirs);
  expect(io.sync).toHaveBeenCalledTimes(2);
});
