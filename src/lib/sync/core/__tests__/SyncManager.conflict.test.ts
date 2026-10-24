import { describe, expect, it } from 'vitest';
import { SyncManager } from '../SyncManager';
import type { SyncAdapter, SyncDoc } from '../SyncAdapter';
import type { SyncTransport } from '../SyncTransport';
import type { SyncItem, SyncMetadataFile } from '../types';

type Body = {
  id: string;
  updated_at: number;
  text?: string;
  deleted_at?: number | null;
  updated_by_device_id?: string | null;
};

type FixtureOptions = {
  metadata: SyncMetadataFile;
  bodies?: Record<string, Body>;
  /** Runs once, just before the first metadata PUT is validated. */
  beforeFirstMetadataPut?: () => void;
  /** Runs once, right after the first body write. */
  afterFirstItemPut?: () => void;
  /** Every metadata PUT reports a lost race. */
  alwaysConflict?: boolean;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function idFromPath(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, '');
}

function fixture(options: FixtureOptions) {
  let metadata = clone(options.metadata);
  let metaEtag = 'm1';
  let version = 1;
  const bodies = new Map<string, Body>(
    Object.entries(options.bodies ?? {}).map(([id, body]) => [id, clone(body)]),
  );
  const bodyEtags = new Map<string, string>(
    [...bodies.keys()].map((id) => [id, `b-${id}-0`]),
  );
  const putItemCalls: Array<{ id: string; etag?: string; data: SyncDoc }> = [];
  const putMetadataCalls: Array<{ etag?: string }> = [];
  let before = options.beforeFirstMetadataPut;
  let afterItem = options.afterFirstItemPut;

  const transport = {
    ensureDirectory: async () => {},
    getMetadata: async () => ({ data: clone(metadata), etag: metaEtag }),
    putMetadata: async (
      _path: string,
      data: SyncMetadataFile,
      etag?: string,
    ) => {
      putMetadataCalls.push({ etag });
      if (before) {
        const run = before;
        before = undefined;
        run();
      }
      if (options.alwaysConflict) {
        metaEtag = `m${++version}`;
        throw new Error('412 Precondition Failed');
      }
      if (etag !== metaEtag) throw new Error('412 Precondition Failed');
      metadata = clone(data);
      metaEtag = `m${++version}`;
    },
    getItem: async (path: string) => {
      const id = idFromPath(path);
      const body = bodies.get(id);
      return { data: body ? clone(body) : null, etag: bodyEtags.get(id) };
    },
    putItem: async (path: string, data: SyncDoc, etag?: string) => {
      const id = idFromPath(path);
      putItemCalls.push({ id, etag, data: clone(data) });
      if (etag !== undefined && etag !== bodyEtags.get(id)) {
        throw new Error('412 Precondition Failed');
      }
      bodies.set(id, clone(data) as Body);
      bodyEtags.set(id, `b-${id}-${++version}`);
      if (afterItem) {
        const run = afterItem;
        afterItem = undefined;
        run();
      }
    },
  };

  let locals: SyncItem[] = [];
  const localUpdates: Array<{ id: string; item: SyncItem }> = [];
  const localDeletes: Array<{ id: string; deletedAt: number }> = [];
  const adapter: SyncAdapter<SyncItem> = {
    dataType: 'prompts',
    remotePath: 'prompts',
    displayName: 'Prompts',
    getLocalItems: async () => locals,
    getLocalItem: async (id) => locals.find((item) => item.id === id) ?? null,
    localItemExists: async (id) => locals.some((item) => item.id === id),
    createLocalItem: async (item) => {
      localUpdates.push({ id: item.id, item: clone(item) });
    },
    updateLocalItem: async (id, item) => {
      localUpdates.push({ id, item: clone(item) });
    },
    deleteLocalItem: async (id, deletedAt) => {
      localDeletes.push({ id, deletedAt });
    },
    toSyncDoc: (item) => ({ ...item }) as SyncDoc,
    fromSyncDoc: (doc) => doc as SyncItem,
    extractMetadata: (item, deviceId) => ({
      updated_at: item.updated_at,
      deleted_at: item.deleted_at ?? null,
      device_id: item.updated_by_device_id ?? deviceId,
    }),
  };

  const manager = new SyncManager({
    deviceId: 'local',
    transport: transport as unknown as SyncTransport,
    adapters: new Map([['prompts', adapter]]),
  });
  return {
    manager,
    putItemCalls,
    putMetadataCalls,
    localUpdates,
    localDeletes,
    metadata: () => metadata,
    body: (id: string) => bodies.get(id),
    setLocals: (items: SyncItem[]) => {
      locals = items;
    },
    touchMetadata: (next: SyncMetadataFile, body?: Body) => {
      metadata = clone(next);
      metaEtag = `m${++version}`;
      if (body) {
        bodies.set(body.id, clone(body));
        bodyEtags.set(body.id, `b-${body.id}-${++version}`);
      }
    },
  };
}

function metadata(items: SyncMetadataFile['items']): SyncMetadataFile {
  return { version: 1, updated_at: 10, items };
}

describe('SyncManager conflict recovery', () => {
  it('control: a conflict-free empty push preserves existing metadata and writes no item', async () => {
    const f = fixture({
      metadata: metadata({ B: { updated_at: 10, device_id: 'remote' } }),
    });
    const result = await f.manager.syncDataType('prompts', 'push');
    expect(result.errors).toEqual([]);
    expect(f.metadata().items.B.updated_at).toBe(10);
    expect(f.putItemCalls).toEqual([]);
  });

  it('keeps a newer remote entry when the metadata write loses a race on a different id', async () => {
    const f = fixture({
      metadata: metadata({
        A: { updated_at: 10, device_id: 'remote' },
        B: { updated_at: 30, device_id: 'remote' },
      }),
      bodies: {
        A: {
          id: 'A',
          updated_at: 10,
          text: 'old A',
          updated_by_device_id: 'remote',
        },
        B: {
          id: 'B',
          updated_at: 30,
          text: 'newest B',
          updated_by_device_id: 'remote',
        },
      },
      beforeFirstMetadataPut: () => {
        // Another device commits B at 40 and a fresh metadata file after our
        // read. The stale snapshot says 30; it must not win the retry.
        f.touchMetadata(
          metadata({
            A: { updated_at: 10, device_id: 'remote' },
            B: { updated_at: 40, device_id: 'remote' },
          }),
          {
            id: 'B',
            updated_at: 40,
            text: 'newest B',
            updated_by_device_id: 'remote',
          },
        );
      },
    });
    f.setLocals([
      { id: 'A', updated_at: 20, updated_by_device_id: 'local' },
      { id: 'B', updated_at: 20, updated_by_device_id: 'local' },
    ]);

    const result = await f.manager.syncDataType('prompts', 'push');

    expect(result.errors).toEqual([]);
    expect(f.metadata().items.A).toMatchObject({
      updated_at: 20,
      device_id: 'local',
    });
    expect(f.metadata().items.B).toMatchObject({
      updated_at: 40,
      device_id: 'remote',
    });
    expect(f.body('B')?.updated_at).toBe(40);
  });

  it('does not let a stale device overwrite a body that is newer than the metadata', async () => {
    const f = fixture({
      metadata: metadata({ B: { updated_at: 10, device_id: 'remote' } }),
      bodies: {
        B: {
          id: 'B',
          updated_at: 30,
          text: 'newest B',
          updated_by_device_id: 'remote',
        },
      },
    });
    f.setLocals([{ id: 'B', updated_at: 20, updated_by_device_id: 'local' }]);

    const result = await f.manager.syncDataType('prompts', 'both');

    expect(result.errors).toEqual([]);
    expect(f.putItemCalls).toEqual([]);
    expect(f.body('B')?.updated_at).toBe(30);
    expect(f.metadata().items.B.updated_at).toBe(30);
    expect(f.localUpdates.at(-1)?.item).toMatchObject({
      id: 'B',
      updated_at: 30,
    });
  });

  it('restarts after a metadata 412 and pulls the winner instead of rolling metadata back', async () => {
    const f = fixture({
      metadata: metadata({ B: { updated_at: 10, device_id: 'remote' } }),
      bodies: {
        B: {
          id: 'B',
          updated_at: 10,
          text: 'old',
          updated_by_device_id: 'remote',
        },
      },
      // Our body write lands, then another device commits B=30 and a new
      // metadata file before our metadata PUT is validated.
      afterFirstItemPut: () => {
        f.touchMetadata(
          metadata({ B: { updated_at: 30, device_id: 'remote' } }),
          {
            id: 'B',
            updated_at: 30,
            text: 'newest',
            updated_by_device_id: 'remote',
          },
        );
      },
    });
    f.setLocals([{ id: 'B', updated_at: 20, updated_by_device_id: 'local' }]);

    const result = await f.manager.syncDataType('prompts', 'both');

    expect(result.errors).toEqual([]);
    expect(f.putMetadataCalls).toHaveLength(2);
    expect(f.metadata().items.B).toMatchObject({
      updated_at: 30,
      device_id: 'remote',
    });
    expect(f.body('B')?.updated_at).toBe(30);
    expect(f.localUpdates.at(-1)?.item).toMatchObject({
      id: 'B',
      updated_at: 30,
    });
  });

  it('applies a deletion tombstone and keeps the tombstone metadata', async () => {
    const f = fixture({
      metadata: metadata({
        B: { updated_at: 30, deleted_at: 25, device_id: 'remote' },
      }),
    });
    f.setLocals([{ id: 'B', updated_at: 20, updated_by_device_id: 'local' }]);

    const result = await f.manager.syncDataType('prompts', 'both');

    expect(result.errors).toEqual([]);
    expect(f.localDeletes).toEqual([{ id: 'B', deletedAt: 25 }]);
    expect(f.metadata().items.B).toMatchObject({
      updated_at: 30,
      deleted_at: 25,
    });
    expect(f.putItemCalls).toEqual([]);
  });

  it('reports repeated 412s instead of silently writing a stale snapshot', async () => {
    const f = fixture({
      metadata: metadata({}),
      alwaysConflict: true,
    });
    f.setLocals([{ id: 'A', updated_at: 20, updated_by_device_id: 'local' }]);

    const result = await f.manager.syncDataType('prompts', 'push');

    expect(f.putMetadataCalls).toHaveLength(3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/412|precondition/i);
  });
});
