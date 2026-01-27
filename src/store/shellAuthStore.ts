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

interface ShellAuthState {
  isLoaded: boolean;
  trustedWorkingDirs: TrustedShellWorkingDir[];

  load: () => Promise<void>;
  addTrustedWorkingDir: (absolutePath: string) => Promise<TrustedShellWorkingDir>;
  removeTrustedWorkingDir: (id: string) => Promise<void>;
  isTrustedWorkingDir: (absolutePath: string) => boolean;
}

const STORE_FILE = 'shell-auth.json';
const STORE_KEY = 'trusted_shell_working_dirs_v1';

function normalizePath(p: string): string {
  return String(p || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '');
}

async function persist(list: TrustedShellWorkingDir[]): Promise<void> {
  await StorageUtil.setItem(STORE_KEY, list, STORE_FILE);
}

export const useShellAuthStore = create<ShellAuthState>((set, get) => ({
  isLoaded: false,
  trustedWorkingDirs: [],

  load: async () => {
    if (get().isLoaded) return;
    const list = (await StorageUtil.getItem<TrustedShellWorkingDir[]>(STORE_KEY, [], STORE_FILE)) || [];
    set({ trustedWorkingDirs: Array.isArray(list) ? list : [], isLoaded: true });
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

