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
const WRITE_MAX_CHARS = 500_000;

type FileReceipt = {
  status: string;
  path?: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  offset?: number;
  text?: string;
  chars?: number;
  truncated?: boolean;
  nextOffset?: number;
  bytes?: number;
  mode?: string;
  created?: boolean;
  to?: string;
  directory?: boolean;
  roots?: string[];
  name?: string;
  under?: string;
  choices?: { folder: string; segment: string; available: string[] }[];
};

function numberArg(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

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
    if (tool === 'read_file') return this.readFile(invocation);
    if (tool === 'write_file') return this.writeFile(invocation);
    if (tool === 'rename') return this.rename(invocation);
    if (tool === 'move') return this.move(invocation);
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

  /**
   * What a file says, as opposed to what it is called. A window comes back with the offset of the
   * rest, because a reply cannot hold a log and a model that reads one whole pays for it twice.
   */
  private async readFile(invocation: ToolInvocation) {
    const args = invocation.args ?? {};
    const under = normalizeUnderName(args.under);
    const rootArg = normalizeRootName(args.root);
    if (under === undefined || !under)
      return failure(
        'INVALID_PATH',
        '`under` is the name path of the file inside the authorized folder, for example "笔记/三月.md". Take the names from a listing.',
      );
    if (rootArg === undefined)
      return failure(
        'INVALID_ROOT',
        '`root` is the name of one authorized folder, at most 120 characters.',
      );
    const offset = numberArg(args.offset, 0);
    const limit = numberArg(args.limit, 8000);
    const receipt = await invoke<FileReceipt>('read_android_directory_file', {
      conversationId: invocation.conversationId,
      root: rootArg || null,
      under,
      offset,
      limit,
    }).catch(() => undefined);
    switch (receipt?.status) {
      case 'file':
        return {
          ok: true,
          path: receipt.path,
          mimeType: receipt.mimeType ?? null,
          sizeBytes: receipt.sizeBytes ?? null,
          offset: receipt.offset,
          text: receipt.text,
          truncated: receipt.truncated,
          nextOffset: receipt.nextOffset,
          hint: receipt.truncated
            ? `The file continues past this window: read the rest with \`offset: ${receipt.nextOffset}\`.`
            : undefined,
        };
      case 'binary':
        return failure(
          'NOT_TEXT',
          `"${under}" is ${receipt.mimeType ?? 'not a text file'}, so its contents cannot be read here. Names, sizes and dates come from android_directory__inventory.`,
        );
      case 'not_a_file':
        return failure(
          'NOT_A_FILE',
          `"${under}" is a folder. List it with android_directory__inventory (\`under\`) or count it with __summarize.`,
        );
      case 'no_such_file':
        return failure(
          'NO_SUCH_FILE',
          `Nothing matches "${under}". A path is made of the names a listing shows, folder by folder; check one level with android_directory__inventory \`under\`, or count the folder with __summarize.`,
        );
      default:
        return (
          this.failureFor(
            (receipt ?? { status: 'unavailable' }) as Inventory,
            rootArg,
            under,
          ) ?? failure('DIRECTORY_UNAVAILABLE', 'The file could not be read.')
        );
    }
  }

  /**
   * One text file written where the user's own files live. Replacing is the case that can lose
   * something, so it is a mode the model has to choose on purpose rather than a default.
   */
  private async writeFile(invocation: ToolInvocation) {
    const args = invocation.args ?? {};
    const under = normalizeUnderName(args.under);
    const rootArg = normalizeRootName(args.root);
    const mode = String(args.mode ?? 'create')
      .trim()
      .toLowerCase();
    const content = typeof args.content === 'string' ? args.content : '';
    if (under === undefined || !under)
      return failure(
        'INVALID_PATH',
        '`under` is the name path of the file to write, for example "笔记/三月.md".',
      );
    if (rootArg === undefined)
      return failure(
        'INVALID_ROOT',
        '`root` is the name of one authorized folder.',
      );
    if (!['create', 'overwrite', 'append'].includes(mode))
      return failure('INVALID_MODE', '`mode` is create, overwrite or append.');
    if (content.length > WRITE_MAX_CHARS)
      return failure(
        'TOO_LARGE',
        `This call holds ${content.length} characters, over the ${WRITE_MAX_CHARS} limit. Write it in pieces with mode "append".`,
      );
    const receipt = await invoke<FileReceipt>('write_android_directory_file', {
      conversationId: invocation.conversationId,
      root: rootArg || null,
      under,
      content,
      mode,
    }).catch(() => undefined);
    switch (receipt?.status) {
      case 'written':
        return {
          ok: true,
          written: true,
          path: receipt.path,
          bytes: receipt.bytes,
          mode: receipt.mode,
          created: receipt.created,
          hint: `Tell the user the file was ${receipt.created ? 'created' : 'updated'} at ${receipt.path} in their authorized folder.`,
        };
      case 'exists':
        return failure(
          'EXISTS',
          `"${under}" already exists. Ask before replacing it, then call again with mode "overwrite", or add to it with mode "append".`,
        );
      case 'read_only':
        return failure(
          'FOLDER_IS_READ_ONLY',
          'That folder was authorized for reading only. Ask the user to turn writing on for it (附件 → 已授权文件夹 → 开启写入); until then nothing can be written there.',
        );
      case 'is_a_folder':
        return failure(
          'IS_A_FOLDER',
          `"${under}" is a folder. Give a file name path, for example "${under}/新笔记.md".`,
        );
      case 'too_large':
        return failure(
          'TOO_LARGE',
          'The device refused a write this size. Write it in pieces with mode "append".',
        );
      case 'ambiguous':
        return failure(
          'ROOT_REQUIRED',
          `Several folders are authorized (${(receipt.roots ?? []).join(', ')}). Pass the one to write into as \`root\`.`,
        );
      case 'refused':
        return failure(
          'WRITE_REFUSED',
          `The folder would not accept the write. Some places on the phone (and most cloud folders) allow reading but not writing; offer the file in 下载 through android_directory__export instead.`,
        );
      default:
        return (
          this.failureFor(
            (receipt ?? { status: 'unavailable' }) as Inventory,
            rootArg,
            under,
          ) ?? failure('WRITE_FAILED', 'The file could not be written.')
        );
    }
  }

  /**
   * Renaming and moving are one shape: find the thing, ask the device to relabel it, and answer
   * with the path it has now, because that is what the user will look for on screen.
   */
  private async rename(invocation: ToolInvocation) {
    const args = invocation.args ?? {};
    const under = normalizeUnderName(args.under);
    const name = typeof args.name === 'string' ? args.name.trim() : '';
    const rootArg = normalizeRootName(args.root);
    if (under === undefined || !under)
      return failure(
        'INVALID_PATH',
        '`under` is the name path of what to rename.',
      );
    if (!name || name.includes('/'))
      return failure(
        'INVALID_NAME',
        '`name` is the new name on its own, with no path in it.',
      );
    if (rootArg === undefined)
      return failure('INVALID_ROOT', '`root` names one authorized folder.');
    return this.relocate(
      'rename_android_directory',
      invocation,
      rootArg,
      under,
      { name },
    );
  }

  private async move(invocation: ToolInvocation) {
    const args = invocation.args ?? {};
    const under = normalizeUnderName(args.under);
    const rootArg = normalizeRootName(args.root);
    const to = normalizeUnderName(args.to) ?? '';
    if (under === undefined || !under)
      return failure(
        'INVALID_PATH',
        '`under` is the name path of what to move.',
      );
    if (rootArg === undefined)
      return failure('INVALID_ROOT', '`root` names one authorized folder.');
    return this.relocate('move_android_directory', invocation, rootArg, under, {
      to,
    });
  }

  private async relocate(
    command: string,
    invocation: ToolInvocation,
    rootArg: string | undefined,
    under: string,
    extra: Record<string, unknown>,
  ) {
    const receipt = await invoke<FileReceipt>(command, {
      conversationId: invocation.conversationId,
      root: rootArg || null,
      under,
      ...extra,
    }).catch(() => undefined);
    const done =
      receipt?.status === 'renamed'
        ? 'renamed'
        : receipt?.status === 'moved'
          ? 'moved'
          : '';
    if (done)
      return {
        ok: true,
        [done]: true,
        path: receipt?.path,
        to: receipt?.to,
        directory: receipt?.directory,
        hint: `Tell the user the ${receipt?.directory ? 'folder' : 'file'} is now at ${receipt?.to}.`,
      };
    if (receipt?.status === 'exists')
      return failure(
        'EXISTS',
        `"${receipt.path}" already sits there. Ask the user what to do with it - rename it first, or pick another name.`,
      );
    if (receipt?.status === 'read_only')
      return failure(
        'FOLDER_IS_READ_ONLY',
        'That folder was authorized for reading only. Renaming and writing need it turned on for writing (附件 → 已授权文件夹 → 开启写入).',
      );
    if (receipt?.status === 'refused')
      return failure(
        'REFUSED',
        'The folder would not accept the change. Cloud folders and some system places allow reading only.',
      );
    return (
      this.failureFor(
        (receipt ?? { status: 'unavailable' }) as Inventory,
        rootArg ?? '',
        under,
      ) ?? failure('RELOCATE_FAILED', 'The name could not be changed.')
    );
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
