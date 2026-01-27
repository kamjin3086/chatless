/**
 * Filesystem 白名单（filesystem allowlist）
 *
 * 说明：
 * - 该 store 仅存放“目录白名单 + alias + rwcd 权限 + 来源”等元数据
 * - 真正传给 MCP filesystem server 的目录列表，会在后续步骤同步写入 `mcp_servers.json`
 * - fresh start：不读取/不迁移旧 `fileSystemAuthStore` 数据
 */

import { create } from 'zustand';
import StorageUtil from '@/lib/storage';

import type { AllowlistDirectory, AllowlistPermissions, AllowlistSource, FileOp } from '@/lib/filesystemAllowlist/types';
import { normalizeAlias, normalizeDirectoryPath } from '@/lib/filesystemAllowlist/allowlist';

type AddDirectoryInput = {
  path: string;
  alias?: string;
  permissions: AllowlistPermissions;
  source: AllowlistSource;
};

type UpdateDirectoryInput = Partial<Pick<AllowlistDirectory, 'alias' | 'permissions' | 'source'>> & {
  path?: string;
};

interface FilesystemAllowlistState {
  isLoaded: boolean;
  directories: AllowlistDirectory[];

  load: () => Promise<void>;

  addDirectory: (input: AddDirectoryInput) => Promise<AllowlistDirectory>;
  updateDirectory: (id: string, updates: UpdateDirectoryInput) => Promise<void>;
  removeDirectory: (id: string) => Promise<void>;

  getByAlias: (alias: string) => AllowlistDirectory | undefined;
  getByPath: (absoluteDirPath: string) => AllowlistDirectory | undefined;

  /** 用于越界审批：给一个文件/目录绝对路径，自动按其所在目录生成条目（递归目录白名单） */
  upsertDirectoryForPath: (params: { absolutePath: string; op: FileOp; source: AllowlistSource }) => Promise<AllowlistDirectory | null>;
}

const STORE_FILE = 'filesystem-allowlist-meta.json';
const STORE_KEY = 'filesystem_allowlist_v1';

async function persist(list: AllowlistDirectory[]): Promise<void> {
  await StorageUtil.setItem(STORE_KEY, list, STORE_FILE);
}

function mergePermissions(a: AllowlistPermissions, b: AllowlistPermissions): AllowlistPermissions {
  // 你的要求：权限模型 rwcd 保持显式；不做“write 隐含 read”的额外自愈（避免意外扩大权限）
  return {
    read: !!(a.read || b.read),
    write: !!(a.write || b.write),
    create: !!(a.create || b.create),
    delete: !!(a.delete || b.delete),
  };
}

function dirname(absPath: string): string {
  const s = String(absPath || '').trim().replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  if (i <= 0) return s;
  return s.slice(0, i);
}

function baseName(absPath: string): string {
  const s = String(absPath || '').trim().replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  return (i >= 0 ? s.slice(i + 1) : s) || 'Dir';
}

function defaultAliasFromDirPath(dirPath: string): string {
  const raw = baseName(dirPath).replace(/[^a-zA-Z0-9]/g, '');
  return raw || 'Dir';
}

function ensureUniqueAlias(desired: string, existing: AllowlistDirectory[], selfId?: string): string {
  const base = normalizeAlias(desired) || 'Dir';
  const used = new Set(
    existing
      .filter((d) => (selfId ? d.id !== selfId : true))
      .map((d) => (d.alias || '').toLowerCase())
      .filter(Boolean)
  );
  let alias = base;
  let n = 2;
  while (used.has(alias.toLowerCase())) {
    alias = `${base}${n}`;
    n += 1;
  }
  return alias;
}

export const useFilesystemAllowlistStore = create<FilesystemAllowlistState>((set, get) => ({
  isLoaded: false,
  directories: [],

  load: async () => {
    if (get().isLoaded) return;
    const list = (await StorageUtil.getItem<AllowlistDirectory[]>(STORE_KEY, [], STORE_FILE)) || [];
    set({ directories: Array.isArray(list) ? list : [], isLoaded: true });
  },

  addDirectory: async (input) => {
    await get().load();
    const dirPath = normalizeDirectoryPath(input.path);
    if (!dirPath) throw new Error('absolute directory path is required');

    const now = Date.now();
    const aliasInput = input.alias ? normalizeAlias(input.alias) : defaultAliasFromDirPath(dirPath);
    const alias = ensureUniqueAlias(aliasInput, get().directories);

    const next: AllowlistDirectory = {
      id: crypto.randomUUID(),
      path: dirPath,
      alias,
      permissions: input.permissions,
      source: input.source || 'unknown',
      createdAt: now,
      updatedAt: now,
    };

    const updated = [next, ...get().directories];
    set({ directories: updated });
    await persist(updated);
    return next;
  },

  updateDirectory: async (id, updates) => {
    await get().load();
    const now = Date.now();
    const list = get().directories;
    const target = list.find((d) => d.id === id);
    if (!target) return;

    const nextPath = updates.path !== undefined ? normalizeDirectoryPath(updates.path) : target.path;
    if (!nextPath) throw new Error('absolute directory path is required');

    const nextAliasRaw = updates.alias !== undefined ? normalizeAlias(updates.alias) : (target.alias || defaultAliasFromDirPath(nextPath));
    const nextAlias = ensureUniqueAlias(nextAliasRaw, list, id);

    const nextPermissions = updates.permissions ? updates.permissions : target.permissions;
    const nextSource = updates.source ? updates.source : target.source;

    const updated = list.map((d) =>
      d.id === id
        ? {
            ...d,
            path: nextPath,
            alias: nextAlias,
            permissions: nextPermissions,
            source: nextSource,
            updatedAt: now,
          }
        : d
    );
    set({ directories: updated });
    await persist(updated);
  },

  removeDirectory: async (id) => {
    await get().load();
    const updated = get().directories.filter((d) => d.id !== id);
    set({ directories: updated });
    await persist(updated);
  },

  getByAlias: (alias) => {
    const a = normalizeAlias(alias).toLowerCase();
    if (!a) return undefined;
    return get().directories.find((d) => (d.alias || '').toLowerCase() === a);
  },

  getByPath: (absoluteDirPath) => {
    const p = normalizeDirectoryPath(absoluteDirPath);
    if (!p) return undefined;
    // Windows 近似大小写不敏感
    const pl = p.toLowerCase();
    return get().directories.find((d) => normalizeDirectoryPath(d.path).toLowerCase() === pl);
  },

  upsertDirectoryForPath: async ({ absolutePath, op, source }) => {
    await get().load();
    const abs = String(absolutePath || '').trim().replace(/\\/g, '/');
    if (!abs) return null;
    const dirPath = normalizeDirectoryPath(dirname(abs));
    if (!dirPath) return null;

    const existing = get().getByPath(dirPath);
    if (existing) {
      const nextPerm = mergePermissions(existing.permissions, {
        read: op === 'read',
        write: op === 'write',
        create: op === 'create',
        delete: op === 'delete',
      });
      await get().updateDirectory(existing.id, { permissions: nextPerm, source: source || existing.source });
      // 返回最新值（从 state 取）
      return get().directories.find((d) => d.id === existing.id) || existing;
    }

    const alias = ensureUniqueAlias(defaultAliasFromDirPath(dirPath), get().directories);
    return get().addDirectory({
      path: dirPath,
      alias,
      permissions: {
        read: op === 'read',
        write: op === 'write',
        create: op === 'create',
        delete: op === 'delete',
      },
      source: source || 'unknown',
    });
  },
}));

