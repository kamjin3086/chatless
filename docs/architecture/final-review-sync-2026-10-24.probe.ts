import { expect, it, vi } from 'vitest';
import { SyncManager } from '@/lib/sync/core/SyncManager';
import type { SyncAdapter } from '@/lib/sync/core/SyncAdapter';
import type { SyncTransport } from '@/lib/sync/core/SyncTransport';
import type { SyncItem, SyncMetadataFile } from '@/lib/sync/core/types';

function fixture(conflict: boolean) {
  let metadata: SyncMetadataFile = { version: 1, updated_at: 10, items: { B: { updated_at: 10, device_id: 'remote' } } };
  let body = { id: 'B', updated_at: 10, text: 'old' };
  let locals: SyncItem[] = [];
  let first = true;
  const transport = {
    ensureDirectory: vi.fn(async () => {}),
    getMetadata: vi.fn(async () => ({ data: structuredClone(metadata), etag: `v${metadata.updated_at}` })),
    putMetadata: vi.fn(async (_path, value) => {
      if (first && conflict) {
        first = false;
        metadata = { version: 1, updated_at: 30, items: { B: { updated_at: 30, device_id: 'remote' } } };
        body = { id: 'B', updated_at: 30, text: 'newest remote content' };
        throw new Error('412 Precondition Failed');
      }
      metadata = structuredClone(value);
    }),
    putItem: vi.fn(async (_path, value) => { body = structuredClone(value); }),
  };
  const adapter = {
    dataType: 'prompts', remotePath: 'prompts', getLocalItems: async () => locals,
    toSyncDoc: (item: SyncItem) => item,
    extractMetadata: (item: SyncItem) => ({ updated_at: item.updated_at, device_id: 'local' }),
  } as SyncAdapter<SyncItem>;
  const manager = new SyncManager({ deviceId: 'local', transport: transport as unknown as SyncTransport,
    adapters: new Map([['prompts', adapter]]) });
  return { manager, transport, metadata: () => metadata, body: () => body,
    setLocals: (items: SyncItem[]) => { locals = items; } };
}

it('control: unchanged remote metadata survives a conflict-free push', async () => {
  const f = fixture(false);
  expect((await f.manager.syncDataType('prompts', 'push')).errors).toEqual([]);
  expect(f.metadata().items.B.updated_at).toBe(10);
  expect(f.transport.putItem).not.toHaveBeenCalled();
});

it('preserves concurrent remote metadata and prevents an older device from overwriting its body', async () => {
  const f = fixture(true);
  expect((await f.manager.syncDataType('prompts', 'push')).errors).toEqual([]);
  const timestampAfterRetry = f.metadata().items.B.updated_at;
  const retryArguments = f.transport.putMetadata.mock.calls[1];
  f.setLocals([{ id: 'B', updated_at: 20 }]);
  expect((await f.manager.syncDataType('prompts', 'push')).errors).toEqual([]);
  console.log('after 412 retry:', timestampAfterRetry, 'retry args:', retryArguments.length,
    'after stale device push:', f.body());
  expect.soft(timestampAfterRetry).toBe(30);
  expect(f.body().updated_at).toBe(30);
});
