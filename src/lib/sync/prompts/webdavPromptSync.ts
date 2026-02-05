import { DatabaseService } from '@/lib/database/services/DatabaseService';
import type { DbPromptItem } from '@/lib/database/repositories/PromptRepository';
import { WebDavClient } from '@/lib/sync/webdav/WebDavClient';
import { getOrCreateSyncDeviceId } from '@/lib/sync/deviceId';

export interface WebDavPromptSyncConfig {
  url: string;
  basePath: string;
  username: string;
  password: string;
}

export interface PromptMetadataEntry {
  updated_at: number;
  deleted_at?: number | null;
  device_id?: string;
}

export interface PromptMetadataFile {
  version: 1;
  updated_at: number;
  items: Record<string, PromptMetadataEntry>;
}

export interface PromptSyncDoc {
  id: string;
  name: string;
  description?: string;
  content: string;
  tags?: string[];
  languages?: string[];
  modelHints?: string[];
  variables?: any[];
  shortcuts?: string[];
  favorite?: boolean;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  updated_by_device_id?: string | null;
  external_id?: string | null;
  stats?: any;
}

export interface PromptSyncResult {
  pushed: number;
  pulled: number;
  skipped: number;
  remoteCreated: boolean;
}

function lexCompare(a: string | undefined | null, b: string | undefined | null): number {
  const aa = a || '';
  const bb = b || '';
  if (aa === bb) return 0;
  return aa > bb ? 1 : -1;
}

function shouldLocalWin(local: { updated_at: number; device_id?: string | null }, remote?: PromptMetadataEntry): boolean {
  if (!remote) return true;
  if (local.updated_at !== remote.updated_at) return local.updated_at > remote.updated_at;
  return lexCompare(local.device_id, remote.device_id) > 0;
}

function shouldRemoteWin(remote: PromptMetadataEntry, local?: { updated_at: number; device_id?: string | null }): boolean {
  if (!local) return true;
  if (remote.updated_at !== local.updated_at) return remote.updated_at > local.updated_at;
  return lexCompare(remote.device_id, local.device_id) > 0;
}

function parseJsonArray(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return [];
  }
}

function parseJsonObject(value: any): any {
  if (!value) return undefined;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return undefined;
  }
}

function toDoc(row: DbPromptItem & Record<string, any>): PromptSyncDoc {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    content: row.content,
    tags: parseJsonArray(row.tags),
    languages: parseJsonArray(row.languages),
    modelHints: parseJsonArray(row.model_hints),
    variables: parseJsonArray(row.variables),
    shortcuts: parseJsonArray(row.shortcuts),
    favorite: !!row.favorite,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? null,
    updated_by_device_id: row.updated_by_device_id ?? null,
    external_id: row.external_id ?? null,
    stats: parseJsonObject(row.stats),
  };
}

function toDbCreate(doc: PromptSyncDoc, deviceId: string): DbPromptItem & Record<string, any> {
  return {
    id: doc.id,
    name: doc.name,
    description: doc.description || '',
    content: doc.content,
    tags: JSON.stringify(doc.tags || []),
    languages: JSON.stringify(doc.languages || []),
    model_hints: JSON.stringify(doc.modelHints || []),
    variables: JSON.stringify(doc.variables || []),
    shortcuts: JSON.stringify(doc.shortcuts || []),
    favorite: doc.favorite ? 1 : 0,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    external_id: doc.external_id || null,
    stats: JSON.stringify(doc.stats || { uses: 0 }),
    deleted_at: doc.deleted_at ?? null,
    updated_by_device_id: doc.updated_by_device_id ?? deviceId,
  };
}

export async function syncPromptsWithWebDav(
  cfg: WebDavPromptSyncConfig,
  input?: { direction?: 'both' | 'push' | 'pull' }
): Promise<PromptSyncResult> {
  const direction = input?.direction ?? 'both';
  const deviceId = await getOrCreateSyncDeviceId();

  const client = new WebDavClient({
    url: cfg.url,
    basePath: cfg.basePath,
    auth: { username: cfg.username, password: cfg.password },
  });

  await client.ensureCollections(['prompts', 'prompts/data']);

  let remoteCreated = false;
  const metaPath = 'prompts/data/metadata.json';
  let remoteMetaEtag: string | undefined;
  let remoteMeta: PromptMetadataFile = { version: 1, updated_at: Date.now(), items: {} };

  const metaResp = await client.getJson<PromptMetadataFile>(metaPath);
  if (metaResp.status === 404 || !metaResp.json) {
    remoteCreated = true;
  } else {
    remoteMeta = metaResp.json;
    remoteMetaEtag = metaResp.etag;
    if (!remoteMeta.items || typeof remoteMeta.items !== 'object') remoteMeta.items = {};
  }

  const db = DatabaseService.getInstance();
  const repo = db.getPromptRepository();
  const rows = (await repo.findAll()) as Array<DbPromptItem & Record<string, any>>;

  const localById = new Map<string, (DbPromptItem & Record<string, any>)>();
  for (const r of rows) localById.set(r.id, r);

  let pushed = 0;
  let pulled = 0;
  let skipped = 0;

  if (direction === 'both' || direction === 'push') {
    for (const row of rows) {
      const doc = toDoc(row);
      const localMeta = { updated_at: doc.updated_at, device_id: doc.updated_by_device_id ?? deviceId };
      const remoteEntry = remoteMeta.items[doc.id];

      if (!shouldLocalWin(localMeta, remoteEntry)) {
        skipped++;
        continue;
      }

      await client.putJson(`prompts/data/${doc.id}.json`, doc);
      remoteMeta.items[doc.id] = {
        updated_at: doc.updated_at,
        deleted_at: doc.deleted_at ?? null,
        device_id: localMeta.device_id,
      };
      pushed++;
    }
  }

  if (direction === 'both' || direction === 'pull') {
    for (const [id, entry] of Object.entries(remoteMeta.items)) {
      const local = localById.get(id);
      const localMeta = local
        ? { updated_at: Number(local.updated_at || 0), device_id: local.updated_by_device_id ?? null }
        : undefined;

      if (!shouldRemoteWin(entry, localMeta)) {
        skipped++;
        continue;
      }

      if (entry.deleted_at) {
        if (local) {
          await repo.update(id, {
            deleted_at: entry.deleted_at,
            updated_at: entry.updated_at,
            updated_by_device_id: entry.device_id ?? deviceId,
          } as any);
        }
        pulled++;
        continue;
      }

      const file = await client.getJson<PromptSyncDoc>(`prompts/data/${id}.json`);
      if (file.status === 404 || !file.json) {
        skipped++;
        continue;
      }

      const doc = file.json;
      const exists = await repo.exists(id);
      if (!exists) {
        await repo.create(toDbCreate(doc, deviceId) as any);
      } else {
        const prev = await repo.findById(id);
        await repo.update(id, {
          name: doc.name,
          description: doc.description || '',
          content: doc.content,
          tags: JSON.stringify(doc.tags || []),
          languages: JSON.stringify(doc.languages || []),
          model_hints: JSON.stringify(doc.modelHints || []),
          variables: JSON.stringify(doc.variables || []),
          shortcuts: JSON.stringify(doc.shortcuts || []),
          favorite: doc.favorite ? 1 : 0,
          updated_at: doc.updated_at,
          created_at: prev?.created_at ?? doc.created_at,
          external_id: doc.external_id || null,
          stats: JSON.stringify(doc.stats || { uses: 0 }),
          deleted_at: doc.deleted_at ?? null,
          updated_by_device_id: doc.updated_by_device_id ?? entry.device_id ?? deviceId,
        } as any);
      }

      pulled++;
    }
  }

  remoteMeta.updated_at = Date.now();
  try {
    await client.putJson(metaPath, remoteMeta, { ifMatch: remoteMetaEtag ?? null });
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (/412|precondition/i.test(msg)) {
      const latest = await client.getJson<PromptMetadataFile>(metaPath);
      const merged: PromptMetadataFile =
        latest.json && latest.json.items ? latest.json : { version: 1, updated_at: Date.now(), items: {} };
      merged.items = { ...merged.items, ...remoteMeta.items };
      merged.updated_at = Date.now();
      await client.putJson(metaPath, merged);
    } else {
      throw e;
    }
  }

  return { pushed, pulled, skipped, remoteCreated };
}
