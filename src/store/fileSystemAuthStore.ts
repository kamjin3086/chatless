/**
 * 用户授权目录管理（user_fs）
 *
 * 说明：
 * - 不使用 localStorage；使用 StorageUtil 持久化
 * - 只保存“用户主动授权过”的目录列表与权限
 */

import { create } from 'zustand';
import StorageUtil from '@/lib/storage';

export type FileOp = 'read' | 'write' | 'create' | 'delete';

export interface AuthorizedDirectory {
  id: string;
  /** 绝对路径 */
  path: string;
  /** 给 LLM/用户使用的别名：@Alias/... */
  alias: string;
  permissions: Record<FileOp, boolean>;
  authorizedAt: number;
}

interface FileSystemAuthState {
  isLoaded: boolean;
  directories: AuthorizedDirectory[];

  load: () => Promise<void>;
  addDirectory: (dir: Omit<AuthorizedDirectory, 'id' | 'authorizedAt'>) => Promise<AuthorizedDirectory>;
  removeDirectory: (id: string) => Promise<void>;
  updateDirectory: (id: string, updates: Partial<Omit<AuthorizedDirectory, 'id'>>) => Promise<void>;

  getByAlias: (alias: string) => AuthorizedDirectory | undefined;
}

const STORE_FILE = 'filesystem-auth.json';
const STORE_KEY = 'authorized_directories_v1';

async function persist(directories: AuthorizedDirectory[]): Promise<void> {
  await StorageUtil.setItem(STORE_KEY, directories, STORE_FILE);
}

export const useFileSystemAuthStore = create<FileSystemAuthState>((set, get) => ({
  isLoaded: false,
  directories: [],

  load: async () => {
    if (get().isLoaded) return;
    const list = (await StorageUtil.getItem<AuthorizedDirectory[]>(STORE_KEY, [], STORE_FILE)) || [];
    set({ directories: Array.isArray(list) ? list : [], isLoaded: true });
  },

  addDirectory: async (dir) => {
    await get().load();
    const next: AuthorizedDirectory = {
      id: crypto.randomUUID(),
      authorizedAt: Date.now(),
      path: dir.path,
      alias: dir.alias,
      permissions: dir.permissions,
    };
    const updated = [next, ...get().directories];
    set({ directories: updated });
    await persist(updated);
    return next;
  },

  removeDirectory: async (id) => {
    await get().load();
    const updated = get().directories.filter((d) => d.id !== id);
    set({ directories: updated });
    await persist(updated);
  },

  updateDirectory: async (id, updates) => {
    await get().load();
    const updated = get().directories.map((d) => (d.id === id ? { ...d, ...updates } : d));
    set({ directories: updated });
    await persist(updated);
  },

  getByAlias: (alias) => {
    const a = String(alias || '').replace(/^@/, '').trim().toLowerCase();
    return get().directories.find((d) => d.alias.toLowerCase() === a);
  },
}));

