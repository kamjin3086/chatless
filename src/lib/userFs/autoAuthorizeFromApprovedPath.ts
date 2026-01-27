import { useFileSystemAuthStore, type FileOp } from '@/store/fileSystemAuthStore';

function normalizePath(p: string): string {
  return String(p || '').trim().replace(/\\/g, '/');
}

function isAbsPath(p: string): boolean {
  const s = normalizePath(p);
  return s.startsWith('/') || /^[A-Za-z]:\//.test(s);
}

function dirname(p: string): string {
  const s = normalizePath(p);
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(0, i) : s;
}

function baseName(p: string): string {
  const s = normalizePath(p);
  const i = s.lastIndexOf('/');
  return (i >= 0 ? s.slice(i + 1) : s) || 'Dir';
}

function mergePermissions(a: Record<FileOp, boolean>, b: Record<FileOp, boolean>): Record<FileOp, boolean> {
  // UX：一旦允许 write/create/delete，就隐含允许 read（否则会出现“写过但读不了”的反直觉体验）
  const impliedRead = !!(b.write || b.create || b.delete);
  return {
    read: !!(a.read || b.read || impliedRead),
    write: !!(a.write || b.write),
    create: !!(a.create || b.create),
    delete: !!(a.delete || b.delete),
  };
}

/**
 * 当用户在审批卡中同意访问某个“绝对路径”后：
 * - 自动把该路径所在目录加入 user_fs 白名单（提升体验）
 * - 生成一个稳定/可读的 alias（若冲突则追加后缀）
 */
export async function autoAuthorizeUserFsDirectoryFromApprovedPath(params: {
  path: string;
  op: FileOp;
}): Promise<{ alias: string; path: string } | null> {
  const p = normalizePath(params.path);
  if (!p || !isAbsPath(p)) return null;

  const dirPath = dirname(p);
  if (!dirPath || !isAbsPath(dirPath)) return null;

  const st = useFileSystemAuthStore.getState();
  await st.load();

  // 如果已存在同路径（Windows 近似大小写不敏感）
  const existing = st.directories.find((d) => normalizePath(d.path).toLowerCase() === dirPath.toLowerCase());
  if (existing) {
    const nextPerm = mergePermissions(existing.permissions, {
      read: params.op === 'read',
      write: params.op === 'write',
      create: params.op === 'create',
      delete: params.op === 'delete',
    });
    await st.updateDirectory(existing.id, { permissions: nextPerm });
    return { alias: existing.alias, path: existing.path };
  }

  // alias：目录名 -> 驼峰/下划线都行，这里只保留字母数字
  const raw = baseName(dirPath).replace(/[^a-zA-Z0-9]/g, '');
  const base = raw || 'UserDir';
  const used = new Set(st.directories.map((d) => d.alias.toLowerCase()));
  let alias = base;
  let n = 2;
  while (used.has(alias.toLowerCase())) {
    alias = `${base}${n}`;
    n += 1;
  }

  await st.addDirectory({
    path: dirPath,
    alias,
    permissions: {
      // UX：默认给 read，避免出现“允许写但不允许读”的困惑
      read: true,
      write: params.op === 'write',
      create: params.op === 'create',
      delete: params.op === 'delete',
    },
  });

  return { alias, path: dirPath };
}

