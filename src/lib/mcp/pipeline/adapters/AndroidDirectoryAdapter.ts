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
/** What a walk covered, next to what it found - the difference matters in a big folder. */
type Totals = {
  scanned: number;
  matched: number;
  files: number;
  directories: number;
  bytes: number;
  unknownMetadata: number;
  stopped: '' | 'limit' | 'row_limit' | 'time_limit';
  elapsedMs: number;
};
type Group = {
  label: string;
  count: number;
  bytes: number;
  samples: string[];
  folderName?: string;
};
type Top = {
  handle: string;
  path: string;
  sizeBytes: number | null;
  modifiedAt: number | null;
};
type Section = {
  folder: AndroidDirectoryFolder;
  entries: Entry[];
  groups: Group[];
  omissions: Omission[];
  totals: Totals;
  largest?: Top[];
  newest?: Top[];
  oldest?: Top[];
};
type Inventory =
  | (Extract<AndroidDirectorySelection, { status: 'ready' }> & {
      entries: Entry[];
      omissions: Omission[];
      totals?: Totals;
      groups?: Group[];
      largest?: Top[];
      newest?: Top[];
      oldest?: Top[];
      /** One per authorized folder; the single-folder keys above carry the first of them. */
      sections?: Section[];
    })
  | { status: 'root_not_found'; roots?: string[] }
  | {
      status: 'subfolder_not_found';
      under?: string;
      choices?: { folder: string; segment: string; available: string[] }[];
    }
  | {
      status: 'saved';
      name: string;
      uri: string;
      count: number;
      bytes: number;
      format: string;
      columns?: string[];
      stopped?: string;
    }
  | { status: 'empty' }
  | Exclude<AndroidDirectorySelection, { status: 'ready' }>;

type Filters = {
  nameContains?: string;
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
  'nameContains',
  'mimeType',
  'minBytes',
  'maxBytes',
  'modifiedFrom',
  'modifiedBefore',
  'groupBy',
  'limit',
  'offset',
  'title',
  'format',
  'columns',
];
const integerKeys = [
  'minBytes',
  'maxBytes',
  'modifiedFrom',
  'modifiedBefore',
] as const;
const PAGE_DEFAULT = 200;
const PAGE_MAX = 1000;

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
  const { mimeType, groupBy, nameContains } = args;
  if (
    mimeType !== undefined &&
    (typeof mimeType !== 'string' ||
      !/^[a-z0-9][a-z0-9.+_-]{0,62}\/(?:[a-z0-9][a-z0-9.+_-]{0,62})?$/i.test(
        mimeType,
      ))
  )
    return;
  if (
    nameContains !== undefined &&
    (typeof nameContains !== 'string' ||
      nameContains.trim().length === 0 ||
      nameContains.length > 120)
  )
    return;
  if (
    groupBy !== undefined &&
    groupBy !== 'type' &&
    groupBy !== 'size' &&
    groupBy !== 'date'
  )
    return;
  const filters: Filters = {
    nameContains: nameContains?.toString().trim(),
    mimeType: mimeType?.toLowerCase(),
    groupBy,
  };
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

function failure(code: string, message: string) {
  return { ok: false, error: { code, message } };
}

/**
 * A walk that stopped is not a folder that is empty, and a model that cannot see the difference
 * will summarize a page as if it were the whole folder. Every answer carries this line when it
 * covers less than it was asked to.
 */
function coverageHint(totals: Totals | undefined, mode: 'list' | 'summary') {
  if (!totals || !totals.stopped) return undefined;
  if (totals.stopped === 'limit')
    return `This is a page, not the folder: ${totals.matched} matches so far, and more may follow. Ask for the next page with \`offset\`, read one subfolder at a time with \`under\`, or count the whole folder with android_directory__summarize.`;
  return `The walk stopped early (${totals.stopped}) after ${totals.scanned} entries, so this covers part of the folder. Narrow with \`under\` or filters, or use android_directory__summarize${mode === 'list' ? ', which counts a whole folder within a time budget' : ''}.`;
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
    const tool = (invocation.tool ?? '').trim().toLowerCase();
    if (tool === 'summarize') return this.summarize(invocation);
    if (tool === 'export') return this.export(invocation);
    return this.inventory(invocation);
  }

  /** Shared argument cleanup: names, filters and paging, before anything is asked of the device. */
  private arguments(invocation: ToolInvocation) {
    const args = invocation.args ?? {};
    const filters = parseFilters(args);
    if (!filters)
      return {
        failure: failure(
          'INVALID_FILTER',
          'Use valid metadata filters only. The folder comes from the current chat, not from paths, URIs or handles.',
        ),
      };
    const rootArg = normalizeRootName(args.root);
    const underArg = normalizeUnderName(args.under);
    if (rootArg === undefined)
      return {
        failure: failure(
          'INVALID_ROOT',
          '`root` is the name of one authorized folder, at most 120 characters, or omitted to read all of them.',
        ),
      };
    if (underArg === undefined)
      return {
        failure: failure(
          'INVALID_UNDER',
          '`under` is a subfolder name path inside the folder (for example "合同/2024") or a folder handle from an earlier result, at most 240 characters.',
        ),
      };
    const limit = args.limit ?? PAGE_DEFAULT;
    const offset = args.offset ?? 0;
    if (
      !Number.isSafeInteger(limit) ||
      (limit as number) < 1 ||
      (limit as number) > PAGE_MAX ||
      !Number.isSafeInteger(offset) ||
      (offset as number) < 0
    )
      return {
        failure: failure(
          'INVALID_PAGE',
          `\`limit\` is 1-${PAGE_MAX} entries per call (default ${PAGE_DEFAULT}), and \`offset\` is a whole number of entries to skip.`,
        ),
      };
    return {
      args: {
        root: rootArg || null,
        under: underArg || null,
        nameContains: filters.nameContains ?? null,
        mimeType: filters.mimeType ?? null,
        minBytes: filters.minBytes ?? null,
        maxBytes: filters.maxBytes ?? null,
        modifiedFrom: filters.modifiedFrom ?? null,
        modifiedBefore: filters.modifiedBefore ?? null,
        groupBy: filters.groupBy ?? null,
      },
      limit: limit as number,
      offset: offset as number,
      underArg,
    };
  }

  /** The answers every folder question shares: which folders, what failed, what was not found. */
  private failureFor(receipt: Inventory, rootArg: string, underArg: string) {
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
        }. Pass \`under\` exactly as one of those names, or as a path of such names; omit it to read the folder as a whole.`,
      );
    }
    // Export answers with its own statuses, and neither of them is a failure to reach the folder.
    if (receipt?.status === 'saved' || receipt?.status === 'empty')
      return undefined;
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
        'The folder could not be read. Ask the user to check or reselect it.',
      );
    return undefined;
  }

  private sectionsOf(
    receipt: Extract<Inventory, { status: 'ready' }>,
  ): Section[] {
    return receipt.sections?.length
      ? receipt.sections
      : [
          {
            folder: receipt.folder,
            entries: receipt.entries ?? [],
            groups: receipt.groups ?? [],
            omissions: receipt.omissions ?? [],
            totals: receipt.totals as Totals,
            largest: receipt.largest,
            newest: receipt.newest,
            oldest: receipt.oldest,
          },
        ];
  }

  private async scan(
    invocation: ToolInvocation,
    command: string,
    extra: Record<string, unknown> = {},
    paged = false,
  ): Promise<
    { failed: true; result: unknown } | { failed: false; receipt: Inventory }
  > {
    const parsed = this.arguments(invocation);
    if ('failure' in parsed) return { failed: true, result: parsed.failure };
    const receipt = await invoke<Inventory | undefined>(command, {
      conversationId: invocation.conversationId,
      ...parsed.args,
      ...(paged ? { limit: parsed.limit, offset: parsed.offset } : {}),
      ...extra,
    }).catch(() => undefined);
    const answer: Inventory = receipt ?? { status: 'unavailable' };
    const problem = this.failureFor(
      answer,
      parsed.args.root ?? '',
      parsed.underArg,
    );
    if (problem) return { failed: true, result: problem };
    return { failed: false, receipt: answer };
  }

  private async inventory(invocation: ToolInvocation) {
    const scanned = await this.scan(
      invocation,
      'inventory_android_directory',
      {},
      true,
    );
    if (scanned.failed) return scanned.result;
    const receipt = scanned.receipt;
    if (receipt.status !== 'ready')
      return failure('DIRECTORY_UNAVAILABLE', 'Unreachable.');
    const sections = this.sectionsOf(receipt);
    const entries: (Entry & { folderName: string })[] = [];
    const folders: { handle: string; name: string; folderName: string }[] = [];
    const omissions: (Omission & { folderName?: string })[] = [];
    const groups: Group[] = [];
    for (const section of sections) {
      const folderName = section.folder.name;
      omissions.push(
        ...(section.omissions ?? []).map((o) => ({ ...o, folderName })),
      );
      groups.push(
        ...(section.groups ?? []).map((group) => ({ ...group, folderName })),
      );
      folders.push(
        ...(section.entries ?? [])
          .filter((entry) => entry.kind === 'directory')
          .map((entry) => ({
            handle: entry.handle,
            name: entry.name,
            folderName,
          })),
      );
      entries.push(
        ...(section.entries ?? [])
          .filter((entry) => entry.kind !== 'directory')
          .map((entry) => ({ ...entry, folderName })),
      );
    }
    const totals = (receipt.totals ?? sections[0]?.totals) as
      | Totals
      | undefined;
    return {
      ok: true,
      folder: sections[0].folder,
      folders,
      entries,
      groups,
      totals,
      omissions,
      hint: coverageHint(totals, 'list'),
      unknownMetadata: totals?.unknownMetadata ?? 0,
    };
  }

  private async summarize(invocation: ToolInvocation) {
    const scanned = await this.scan(invocation, 'summarize_android_directory');
    if (scanned.failed) return scanned.result;
    const receipt = scanned.receipt;
    if (receipt.status !== 'ready')
      return failure('DIRECTORY_UNAVAILABLE', 'Unreachable.');
    const sections = this.sectionsOf(receipt);
    const totals = (receipt.totals ?? sections[0]?.totals) as
      | Totals
      | undefined;
    return {
      ok: true,
      folders: sections.map((section) => ({
        name: section.folder.name,
        totals: section.totals,
        groups: section.groups ?? [],
        largest: section.largest ?? [],
        newest: section.newest ?? [],
        oldest: section.oldest ?? [],
        omissions: section.omissions ?? [],
      })),
      totals,
      groups: sections[0]?.groups ?? [],
      largest: sections[0]?.largest ?? [],
      newest: sections[0]?.newest ?? [],
      oldest: sections[0]?.oldest ?? [],
      omissions: sections.flatMap((section) => section.omissions ?? []),
      hint: coverageHint(totals, 'summary'),
    };
  }

  private async export(invocation: ToolInvocation) {
    const args = invocation.args ?? {};
    const format = String(args.format ?? 'md')
      .trim()
      .toLowerCase();
    if (!['md', 'csv', 'txt'].includes(format))
      return failure('INVALID_FORMAT', '`format` is one of md, csv, txt.');
    const columns = args.columns;
    if (
      columns !== undefined &&
      typeof columns !== 'string' &&
      !Array.isArray(columns)
    )
      return failure(
        'INVALID_COLUMNS',
        '`columns` is a comma separated list of path, name, size, date, type.',
      );
    const scanned = await this.scan(invocation, 'export_android_directory', {
      title: typeof args.title === 'string' ? args.title.trim() || null : null,
      format,
      columns: Array.isArray(columns) ? columns.join(',') : (columns ?? null),
    });
    if (scanned.failed) return scanned.result;
    const receipt = scanned.receipt;
    if (receipt.status === 'empty')
      return {
        ok: true,
        empty: true,
        written: false,
        message:
          'No files matched, so nothing was written. Say what was searched for and offer to widen it.',
      };
    if (receipt.status !== 'saved')
      return failure(
        'EXPORT_FAILED',
        'The listing could not be written to the phone. Ask the user to retry, or offer the list in chat instead.',
      );
    return {
      ok: true,
      written: true,
      file: receipt.name,
      uri: receipt.uri,
      count: receipt.count,
      bytes: receipt.bytes,
      format: receipt.format,
      columns: receipt.columns ?? [],
      stopped: receipt.stopped || undefined,
      hint: `Tell the user the file is in 下载 (${receipt.name}) and how many entries it holds; it is a new file, nothing in their folder changed.${
        receipt.stopped
          ? ` The listing stopped early (${receipt.stopped}), so say it may be partial.`
          : ''
      }`,
    };
  }
}
