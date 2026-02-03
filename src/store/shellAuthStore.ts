/**
 * shell_executor 授权记忆（白名单）
 *
 * 目标：减少重复审批（尤其是同一工作目录下的常见开发命令）。
 * 约束：高风险命令仍由 ToolExecutionPipeline.isForcedApproval 强制人工确认。
 */

import { create } from 'zustand';
import StorageUtil from '@/lib/storage';

export interface TrustedShellWorkingDir {
  id: string;
  /** 绝对路径（归一化后，使用 /） */
  path: string;
  authorizedAt: number;
}

/** 自动清理偏好设置（天数） */
export type CleanupDays = 0 | 30 | 90 | 180;

interface ShellAuthState {
  isLoaded: boolean;
  trustedWorkingDirs: TrustedShellWorkingDir[];
  /** 自动清理天数，0表示不清理 */
  cleanupDays: CleanupDays;

  load: () => Promise<void>;
  addTrustedWorkingDir: (absolutePath: string) => Promise<TrustedShellWorkingDir>;
  removeTrustedWorkingDir: (id: string) => Promise<void>;
  isTrustedWorkingDir: (absolutePath: string) => boolean;
  setCleanupDays: (days: CleanupDays) => Promise<void>;
  cleanupExpired: () => Promise<void>;
}

const STORE_FILE = 'shell-auth.json';
const STORE_KEY = 'trusted_shell_working_dirs_v1';
const CLEANUP_KEY = 'shell_auth_cleanup_days';

function normalizePath(p: string): string {
  return String(p || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '');
}

async function persist(list: TrustedShellWorkingDir[]): Promise<void> {
  await StorageUtil.setItem(STORE_KEY, list, STORE_FILE);
}

async function persistCleanupDays(days: CleanupDays): Promise<void> {
  await StorageUtil.setItem(CLEANUP_KEY, days, STORE_FILE);
}

export const useShellAuthStore = create<ShellAuthState>((set, get) => ({
  isLoaded: false,
  trustedWorkingDirs: [],
  cleanupDays: 90,

  load: async () => {
    if (get().isLoaded) return;
    const list = (await StorageUtil.getItem<TrustedShellWorkingDir[]>(STORE_KEY, [], STORE_FILE)) || [];
    const days = (await StorageUtil.getItem<CleanupDays>(CLEANUP_KEY, 90, STORE_FILE)) || 90;
    set({ 
      trustedWorkingDirs: Array.isArray(list) ? list : [], 
      cleanupDays: days,
      isLoaded: true 
    });
    // 自动清理过期项
    await get().cleanupExpired();
  },

  addTrustedWorkingDir: async (absolutePath) => {
    await get().load();
    const p = normalizePath(absolutePath);
    if (!p) {
      throw new Error('workingDir is required');
    }
    const exists = get().trustedWorkingDirs.find((d) => normalizePath(d.path).toLowerCase() === p.toLowerCase());
    if (exists) return exists;

    const next: TrustedShellWorkingDir = {
      id: crypto.randomUUID(),
      authorizedAt: Date.now(),
      path: p,
    };
    const updated = [next, ...get().trustedWorkingDirs];
    set({ trustedWorkingDirs: updated });
    await persist(updated);
    return next;
  },

  removeTrustedWorkingDir: async (id) => {
    await get().load();
    const updated = get().trustedWorkingDirs.filter((d) => d.id !== id);
    set({ trustedWorkingDirs: updated });
    await persist(updated);
  },

  isTrustedWorkingDir: (absolutePath) => {
    const p = normalizePath(absolutePath);
    if (!p) return false;
    // 任一已信任目录是 workingDir 的前缀即可（子目录也视为信任）
    const lp = p.toLowerCase();
    return get().trustedWorkingDirs.some((d) => {
      const dp = normalizePath(d.path).toLowerCase();
      return lp === dp || lp.startsWith(`${dp}/`);
    });
  },

  setCleanupDays: async (days) => {
    set({ cleanupDays: days });
    await persistCleanupDays(days);
    await get().cleanupExpired();
  },

  cleanupExpired: async () => {
    const { cleanupDays, trustedWorkingDirs } = get();
    if (cleanupDays === 0) return; // 不清理
    
    const now = Date.now();
    const maxAge = cleanupDays * 24 * 60 * 60 * 1000;
    const filtered = trustedWorkingDirs.filter(d => (now - d.authorizedAt) < maxAge);
    
    // 限制最多100条
    const limited = filtered.slice(0, 100);
    
    if (limited.length !== trustedWorkingDirs.length) {
      set({ trustedWorkingDirs: limited });
      await persist(limited);
    }
  },
}));

/** 在“已信任工作目录”下，允许免审批的低风险可执行文件（可按需扩展） */
const SAFE_EXECUTABLES = new Set([
  'pnpm',
  'npm',
  'npx',
  'yarn',
  'node',
  'python',
  'python3',
  'pip',
  'pip3',
  'git',
  'cargo',
  'rustc',
]);

export function isShellCommandTrusted(params: { command?: unknown; workingDir?: unknown }): boolean {
  const command = typeof params.command === 'string' ? params.command : '';
  const workingDir = typeof params.workingDir === 'string' ? params.workingDir : '';
  if (!command.trim() || !workingDir.trim()) return false;

  const base = command.trim().split(/\s+/)[0]?.trim().toLowerCase() || '';
  if (!base) return false;
  if (!SAFE_EXECUTABLES.has(base)) return false;

  try {
    return useShellAuthStore.getState().isTrustedWorkingDir(workingDir);
  } catch {
    return false;
  }
}

