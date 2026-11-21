import { invoke } from '@tauri-apps/api/core';
import type {
  AndroidDirectoryFolder,
  AndroidDirectorySelection,
} from '@/lib/documents/android/androidDirectorySelection';
import {
  ANDROID_DIRECTORY_SERVER,
  isAndroidDirectoryTool,
} from '@/lib/mcp/nativeTools/androidDirectory';
import { isAndroidTauri } from '@/lib/utils/runtimePlatform';
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

type Entry = AndroidDirectoryFolder & {
  parentHandle: string;
  kind: 'directory' | 'file';
  mimeType: string | null;
  sizeBytes: number | null;
  modifiedAt: number | null;
};
type Omission = {
  reason: 'unreadable' | 'duplicate_or_cycle' | 'depth_limit' | 'entry_limit';
  parentHandle: string;
  handle?: string;
  name?: string;
};
type Inventory =
  | (Extract<AndroidDirectorySelection, { status: 'ready' }> & {
      entries: Entry[];
      omissions: Omission[];
    })
  | Exclude<AndroidDirectorySelection, { status: 'ready' }>;

type Filters = {
  mimeType?: string;
  minBytes?: number;
  maxBytes?: number;
  modifiedFrom?: number;
  modifiedBefore?: number;
  groupBy?: 'type' | 'size' | 'date';
};
const allowedKeys = [
  'mimeType',
  'minBytes',
  'maxBytes',
  'modifiedFrom',
  'modifiedBefore',
  'groupBy',
];
const integerKeys = [
  'minBytes',
  'maxBytes',
  'modifiedFrom',
  'modifiedBefore',
] as const;

function parseFilters(args: Record<string, unknown>): Filters | undefined {
  if (Object.keys(args).some((key) => !allowedKeys.includes(key))) return;
  const { mimeType, groupBy } = args;
  if (
    mimeType !== undefined &&
    (typeof mimeType !== 'string' ||
      !/^[a-z0-9][a-z0-9.+_-]{0,62}\/(?:[a-z0-9][a-z0-9.+_-]{0,62})?$/i.test(
        mimeType,
      ))
  )
    return;
  if (
    groupBy !== undefined &&
    groupBy !== 'type' &&
    groupBy !== 'size' &&
    groupBy !== 'date'
  )
    return;
  const filters: Filters = { mimeType: mimeType?.toLowerCase(), groupBy };
  for (const key of integerKeys) {
    const value = args[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
      return;
    filters[key] = value;
  }
  if ((filters.minBytes ?? 0) > (filters.maxBytes ?? Infinity)) return;
  if ((filters.modifiedFrom ?? 0) >= (filters.modifiedBefore ?? Infinity))
    return;
  return filters;
}

function matches(
  entry: Entry,
  filters: Filters,
): 'match' | 'unknown' | 'excluded' {
  const { mimeType, sizeBytes, modifiedAt } = entry;
  let unknown = false;
  if (filters.mimeType !== undefined) {
    if (mimeType === null) unknown = true;
    else if (
      filters.mimeType.endsWith('/')
        ? !mimeType.startsWith(filters.mimeType)
        : mimeType !== filters.mimeType
    )
      return 'excluded';
  }
  if (filters.minBytes !== undefined || filters.maxBytes !== undefined) {
    if (sizeBytes === null) unknown = true;
    else if (
      sizeBytes < (filters.minBytes ?? 0) ||
      sizeBytes > (filters.maxBytes ?? Infinity)
    )
      return 'excluded';
  }
  if (
    filters.modifiedFrom !== undefined ||
    filters.modifiedBefore !== undefined
  ) {
    if (modifiedAt === null) unknown = true;
    else if (
      modifiedAt < (filters.modifiedFrom ?? 0) ||
      modifiedAt >= (filters.modifiedBefore ?? Infinity)
    )
      return 'excluded';
  }
  return unknown ? 'unknown' : 'match';
}

function groupLabel(entry: Entry, by: NonNullable<Filters['groupBy']>): string {
  if (by === 'type') return entry.mimeType ?? 'Unknown type';
  if (by === 'date')
    return entry.modifiedAt === null
      ? 'Unknown date'
      : new Date(entry.modifiedAt).toISOString().slice(0, 7);
  if (entry.sizeBytes === null) return 'Unknown size';
  const mib = 1024 * 1024;
  if (entry.sizeBytes < mib) return 'Under 1 MiB';
  return entry.sizeBytes < 10 * mib ? '1 to under 10 MiB' : '10 MiB or more';
}

function failure(code: string, message: string) {
  return { ok: false, error: { code, message } };
}

export class AndroidDirectoryAdapter implements ToolAdapter {
  readonly server = ANDROID_DIRECTORY_SERVER;

  canHandle(invocation: ToolInvocation): boolean {
    return (
      isAndroidTauri() &&
      isAndroidDirectoryTool(invocation.server, invocation.tool)
    );
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    const filters = parseFilters(invocation.args ?? {});
    if (!filters)
      return failure(
        'INVALID_FILTER',
        'Use valid metadata filters only. The folder comes from the current chat, not from paths, URIs or handles.',
      );
    const receipt = await invoke<Inventory>('inventory_android_directory', {
      conversationId: invocation.conversationId,
    }).catch(() => undefined);
    if (receipt?.status === 'none')
      return failure(
        'DIRECTORY_NOT_SELECTED',
        'Ask the user to choose a folder in this chat.',
      );
    if (receipt?.status === 'revoked')
      return failure(
        'DIRECTORY_ACCESS_LOST',
        'Folder access was lost. Ask the user to reselect or forget the folder in this chat.',
      );
    if (receipt?.status !== 'ready')
      return failure(
        'DIRECTORY_UNAVAILABLE',
        'The folder could not be inventoried. Ask the user to check or reselect it.',
      );

    const entries: Entry[] = [];
    const folders: Entry[] = [];
    const excludedForUnknownMetadata: (AndroidDirectoryFolder & {
      parentHandle: string;
    })[] = [];
    let filteredOut = 0;
    const groups = new Map<string, string[]>();
    for (const entry of receipt.entries) {
      if (entry.kind === 'directory') {
        folders.push(entry);
        continue;
      }
      const match = matches(entry, filters);
      if (match === 'excluded') filteredOut += 1;
      if (match === 'unknown') {
        const { handle, name, parentHandle } = entry;
        excludedForUnknownMetadata.push({ handle, name, parentHandle });
      }
      if (match !== 'match') continue;
      entries.push(entry);
      if (filters.groupBy) {
        const label = groupLabel(entry, filters.groupBy);
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label)?.push(entry.handle);
      }
    }
    return {
      ok: true,
      folder: receipt.folder,
      folders,
      entries,
      groups: [...groups].map(([label, handles]) => ({ label, handles })),
      omissions: receipt.omissions,
      filteredOut,
      excludedForUnknownMetadata,
    };
  }
}
