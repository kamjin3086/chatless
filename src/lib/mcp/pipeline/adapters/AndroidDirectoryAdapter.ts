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
  /** Name path from the scanned folder, e.g. `合同/2024/报告.pdf`. */
  path?: string;
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
      /** One per authorized folder; the single-folder keys above carry the first of them. */
      sections?: Section[];
    })
  | { status: 'root_not_found'; roots?: string[] }
  | {
      status: 'subfolder_not_found';
      under?: string;
      choices?: { folder: string; segment: string; available: string[] }[];
    }
  | Exclude<AndroidDirectorySelection, { status: 'ready' }>;

type Section = {
  folder: AndroidDirectoryFolder;
  entries: Entry[];
  omissions: Omission[];
};

type Filters = {
  mimeType?: string;
  minBytes?: number;
  maxBytes?: number;
  modifiedFrom?: number;
  modifiedBefore?: number;
  groupBy?: 'type' | 'size' | 'date';
};
const allowedKeys = [
  'root',
  'under',
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

/**
 * What a model passes for `root` is whatever the user called the folder, typed through a
 * chatbot: full-width quotes around it, a trailing space, or an empty string when it has no
 * name to give. None of that means "look for a folder literally called that". Normalize it into
 * either a name or no name, so the answer the model gets is about the folders that exist.
 * `undefined` means the value cannot be a name at all (a number, an object, too long).
 */
export function normalizeRootName(value: unknown): string | undefined {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return undefined;
  const text = value
    .normalize('NFKC')
    .replace(/[“”„«»『』「」【】"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 120 ? undefined : text;
}

/**
 * `under` is a path of folder names, so it keeps its separators; everything else is the same
 * chat-mess cleanup as a folder name. A handle is allowed too, because a listing gives handles
 * for everything it could not name well.
 */
export function normalizeUnderName(value: unknown): string | undefined {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return undefined;
  const text = value
    .normalize('NFKC')
    .replace(/[“”„«»『』「」【】"'`]/g, '')
    .replace(/[\\／]/g, '/')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .replace(/\/+$/, '')
    .trim();
  return text.length > 240 ? undefined : text;
}

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
    const rootArg = normalizeRootName(invocation.args?.root);
    const underArg = normalizeUnderName(invocation.args?.under);
    if (
      'root' in (invocation.args ?? {}) &&
      (rootArg === undefined || rootArg.length > 120)
    )
      return failure(
        'INVALID_ROOT',
        '`root` is the name of one authorized folder, at most 120 characters, or omitted to read all of them.',
      );
    if (
      'under' in (invocation.args ?? {}) &&
      (underArg === undefined || underArg.length > 240)
    )
      return failure(
        'INVALID_UNDER',
        '`under` is a subfolder name path inside the folder (for example "合同/2024") or a folder handle from an earlier result, at most 240 characters.',
      );
    const receipt = await invoke<Inventory>('inventory_android_directory', {
      conversationId: invocation.conversationId,
      root: rootArg || null,
      under: underArg || null,
    }).catch(() => undefined);
    if (receipt?.status === 'root_not_found')
      return failure(
        'ROOT_NOT_FOUND',
        `No authorized folder matches "${rootArg}". Authorized: ${
          (receipt.roots ?? []).join(', ') || 'none'
        }. Read again with one of those names exactly as written, or with no \`root\` to read all of them. A folder is named by the user, so a path such as /sdcard/Download is not a name.`,
      );
    if (receipt?.status === 'subfolder_not_found') {
      const choices = (receipt.choices ?? [])
        .map(
          (choice) =>
            `${choice.folder}: ${choice.available.slice(0, 12).join(', ') || 'no subfolders'}`,
        )
        .join(' | ');
      return failure(
        'SUBFOLDER_NOT_FOUND',
        `No subfolder matches "${receipt.under ?? underArg}". Subfolders that do exist - ${
          choices || 'none'
        }. Read a path segment exactly as listed (for example under "合同"), or drop \`under\` to read the folder as a whole.`,
      );
    }
    if (receipt?.status === 'none')
      return failure(
        'DIRECTORY_NOT_SELECTED',
        'No folder is authorized for this app. Ask the user to attach one from the attachment menu (选择文件夹), or to turn Agent access on for an authorized folder.',
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

    const sections: Section[] =
      receipt.sections && receipt.sections.length
        ? receipt.sections
        : [
            {
              folder: receipt.folder,
              entries: receipt.entries,
              omissions: receipt.omissions,
            },
          ];

    const entries: (Entry & { folderName: string })[] = [];
    const folders: (Entry & { folderName: string })[] = [];
    const excludedForUnknownMetadata: (AndroidDirectoryFolder & {
      parentHandle: string;
    })[] = [];
    const omissions: (Omission & { folderName?: string })[] = [];
    let filteredOut = 0;
    const groups = new Map<string, string[]>();
    for (const section of sections) {
      const folderName = section.folder.name;
      omissions.push(
        ...(section.omissions ?? []).map((omission) => ({
          ...omission,
          folderName,
        })),
      );
      for (const entry of section.entries ?? []) {
        if (entry.kind === 'directory') {
          folders.push({ ...entry, folderName });
          continue;
        }
        const match = matches(entry, filters);
        if (match === 'excluded') filteredOut += 1;
        if (match === 'unknown') {
          const { handle, name, parentHandle } = entry;
          excludedForUnknownMetadata.push({ handle, name, parentHandle });
        }
        if (match !== 'match') continue;
        entries.push({ ...entry, folderName });
        if (filters.groupBy) {
          const label =
            sections.length > 1
              ? `${folderName} · ${groupLabel(entry, filters.groupBy)}`
              : groupLabel(entry, filters.groupBy);
          if (!groups.has(label)) groups.set(label, []);
          groups.get(label)?.push(entry.handle);
        }
      }
    }
    // A folder stopped at the entry cap is the case where one flat re-read helps nobody: say
    // what to do instead of letting the model pull the same folder again.
    const truncated = omissions.some(
      (omission) => omission.reason === 'entry_limit',
    );
    return {
      ok: true,
      folder: sections[0].folder,
      folders,
      entries,
      groups: [...groups].map(([label, handles]) => ({ label, handles })),
      omissions,
      filteredOut,
      excludedForUnknownMetadata,
      hint:
        truncated && !underArg
          ? 'This listing stopped at the entry limit. Read one subfolder at a time with `under` (a name from `folders` or a `path`), rather than reading the whole folder again.'
          : undefined,
    };
  }
}
