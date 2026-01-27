/**
 * 用户授权文件系统操作（user_fs）
 *
 * 规则：
 * - 只允许访问用户已授权的目录（alias 映射）
 * - 只允许 alias 路径（@Alias/relative/path）
 * - 严格禁止 .. 等路径穿越
 */

import { useFileSystemAuthStore, type AuthorizedDirectory, type FileOp } from '@/store/fileSystemAuthStore';

function assertSafeRelativePath(p: string): void {
  const path = String(p || '').trim().replace(/\\/g, '/');
  if (!path) throw new Error('relative path is required');
  if (path.startsWith('/') || /^[A-Za-z]:\//.test(path)) throw new Error('absolute path is not allowed');
  if (path === '..' || path.startsWith('../') || path.includes('/../')) throw new Error('path traversal is not allowed');
  if (path.includes('://')) throw new Error('protocol path is not allowed');
}

export async function ensureUserFsLoaded(): Promise<void> {
  const st = useFileSystemAuthStore.getState();
  if (!st.isLoaded) await st.load();
}

export function listAuthorizedDirectories(): Array<Pick<AuthorizedDirectory, 'id' | 'alias' | 'path' | 'permissions'>> {
  const st = useFileSystemAuthStore.getState();
  return st.directories.map((d) => ({ id: d.id, alias: d.alias, path: d.path, permissions: d.permissions }));
}

function resolveAliasPath(aliasPath: string): { dir: AuthorizedDirectory; relative: string } {
  const raw = String(aliasPath || '').trim();
  if (!raw.startsWith('@')) {
    throw new Error('Path must use an authorized alias, e.g. @ProjectDocs/file.txt. Use user_fs.list_authorized_directories first.');
  }

  const normalized = raw.replace(/\\/g, '/');
  const slash = normalized.indexOf('/');
  const alias = (slash >= 0 ? normalized.slice(1, slash) : normalized.slice(1)).trim();
  const relative = slash >= 0 ? normalized.slice(slash + 1) : '';

  if (!alias) throw new Error('Alias is required, e.g. @ProjectDocs/...');
  assertSafeRelativePath(relative || 'x'); // allow empty? no; we enforce file path below

  const st = useFileSystemAuthStore.getState();
  const dir = st.getByAlias(alias);
  if (!dir) {
    throw new Error(`Alias "@${alias}" is not authorized. Ask user to authorize it in Settings -> 安全.`);
  }

  return { dir, relative };
}

function assertPermission(dir: AuthorizedDirectory, op: FileOp): void {
  if (!dir.permissions?.[op]) throw new Error(`Permission denied: ${op} is not allowed for @${dir.alias}`);
}

export async function readUserFile(aliasPath: string, maxLines?: number): Promise<string> {
  await ensureUserFsLoaded();
  const { dir, relative } = resolveAliasPath(aliasPath);
  assertPermission(dir, 'read');

  const { join } = await import('@tauri-apps/api/path');
  const { readTextFile } = await import('@tauri-apps/plugin-fs');
  const fullPath = await join(dir.path, relative);
  const content = await readTextFile(fullPath);

  if (typeof maxLines === 'number' && maxLines > 0) {
    const lines = content.split('\n');
    return lines.slice(0, maxLines).join('\n') + (lines.length > maxLines ? `\n... (${lines.length - maxLines} more lines)` : '');
  }
  return content;
}

export async function writeUserFile(aliasPath: string, content: string): Promise<string> {
  await ensureUserFsLoaded();
  const { dir, relative } = resolveAliasPath(aliasPath);
  assertPermission(dir, 'write');

  const { join } = await import('@tauri-apps/api/path');
  const { writeTextFile, exists, mkdir } = await import('@tauri-apps/plugin-fs');
  const fullPath = await join(dir.path, relative);
  const normalized = String(fullPath).replace(/\\/g, '/');
  const parent = normalized.substring(0, normalized.lastIndexOf('/'));
  if (parent && !(await exists(parent))) {
    await mkdir(parent, { recursive: true });
  }
  await writeTextFile(fullPath, String(content ?? ''));
  return `User file written: ${fullPath}`;
}

