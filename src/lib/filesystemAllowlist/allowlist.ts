import type { AllowlistDirectory, FileOp, ResolvedAllowlistPath } from './types';

function normalizeSlashes(p: string): string {
  return String(p || '').trim().replace(/\\/g, '/');
}

export function isAbsolutePath(p: string): boolean {
  const s = normalizeSlashes(p);
  return s.startsWith('/') || /^[A-Za-z]:\//.test(s);
}

function isWindowsLikeAbsolutePath(p: string): boolean {
  return /^[A-Za-z]:\//.test(normalizeSlashes(p));
}

function shouldCaseInsensitiveMatch(p: string): boolean {
  // Windows 盘符路径通常大小写不敏感
  return isWindowsLikeAbsolutePath(p);
}

export function normalizeAbsolutePath(p: string): string {
  const s = normalizeSlashes(p);
  if (!s) return '';
  if (s.includes('://')) return ''; // 防止把 URL 当成文件路径
  if (!isAbsolutePath(s)) return '';

  // 统一驱动器字母：C:/ -> C:/
  const out = s;

  // 去掉末尾多余的 /，但保留根目录（/）和盘符根（C:/）
  if (out === '/') return '/';
  if (/^[A-Za-z]:\/$/.test(out)) return out;
  return out.replace(/\/+$/g, '');
}

export function normalizeDirectoryPath(p: string): string {
  const abs = normalizeAbsolutePath(p);
  if (!abs) return '';
  // directory path 也不需要末尾 /
  return abs;
}

export function normalizeAlias(input: string): string {
  // alias 仅用于 @Alias/..，不接受空格
  return String(input || '').trim().replace(/^@/, '').replace(/\s+/g, '');
}

export function parseAliasPath(input: string): { alias: string; relative: string } | null {
  const raw = String(input || '').trim();
  if (!raw.startsWith('@')) return null;
  const normalized = normalizeSlashes(raw);
  const slash = normalized.indexOf('/');
  const alias = normalizeAlias(slash >= 0 ? normalized.slice(1, slash) : normalized.slice(1));
  const relative = slash >= 0 ? normalized.slice(slash + 1) : '';
  if (!alias) return null;
  return { alias, relative };
}

function assertSafeRelativePath(p: string): void {
  const path = normalizeSlashes(p);
  if (path === '' || path === '.') return;
  if (path.startsWith('/') || /^[A-Za-z]:\//.test(path)) throw new Error('absolute path is not allowed for alias-relative path');
  if (path === '..' || path.startsWith('../') || path.includes('/../')) throw new Error('path traversal is not allowed');
  if (path.includes('://')) throw new Error('protocol path is not allowed');
}

export function joinAbsoluteAndRelative(dirPath: string, relative: string): string {
  const base = normalizeDirectoryPath(dirPath);
  if (!base) return '';
  const rel = normalizeSlashes(relative);
  assertSafeRelativePath(rel);
  if (!rel) return base;
  return normalizeAbsolutePath(`${base}/${rel}`) || `${base}/${rel}`.replace(/\/+/g, '/');
}

function buildComparable(p: string, caseInsensitive: boolean): string {
  const s = normalizeSlashes(p);
  return caseInsensitive ? s.toLowerCase() : s;
}

export function isPathWithinDirectory(params: { absolutePath: string; directoryPath: string }): boolean {
  const abs = normalizeAbsolutePath(params.absolutePath);
  const dir = normalizeDirectoryPath(params.directoryPath);
  if (!abs || !dir) return false;
  const ci = shouldCaseInsensitiveMatch(abs) || shouldCaseInsensitiveMatch(dir);
  const a = buildComparable(abs, ci);
  const d = buildComparable(dir, ci);
  if (a === d) return true;
  // 目录递归：以 d/ 为前缀
  return a.startsWith(d.endsWith('/') ? d : `${d}/`);
}

export function findBestMatchingDirectory(
  absolutePath: string,
  directories: AllowlistDirectory[]
): AllowlistDirectory | undefined {
  const abs = normalizeAbsolutePath(absolutePath);
  if (!abs) return undefined;
  let best: AllowlistDirectory | undefined;
  let bestLen = -1;
  for (const d of directories || []) {
    const dir = normalizeDirectoryPath(d.path);
    if (!dir) continue;
    if (!isPathWithinDirectory({ absolutePath: abs, directoryPath: dir })) continue;
    const len = dir.length;
    if (len > bestLen) {
      best = d;
      bestLen = len;
    }
  }
  return best;
}

export function computeRelativePath(params: { absolutePath: string; directoryPath: string }): string | undefined {
  const abs = normalizeAbsolutePath(params.absolutePath);
  const dir = normalizeDirectoryPath(params.directoryPath);
  if (!abs || !dir) return undefined;
  const ci = shouldCaseInsensitiveMatch(abs) || shouldCaseInsensitiveMatch(dir);
  const a = buildComparable(abs, ci);
  const d = buildComparable(dir, ci);
  if (a === d) return '';
  const prefix = d.endsWith('/') ? d : `${d}/`;
  if (!a.startsWith(prefix)) return undefined;
  // 用原始 abs 截取，保持原大小写显示
  const rel = abs.slice(prefix.length);
  return rel;
}

export function resolveAllowlistPath(params: {
  inputPath: string;
  directories: AllowlistDirectory[];
}): ResolvedAllowlistPath {
  const raw = String(params.inputPath || '').trim();
  if (!raw) throw new Error('path is required');

  // @Alias/...
  const aliasParsed = parseAliasPath(raw);
  if (aliasParsed) {
    const alias = aliasParsed.alias;
    const dir = (params.directories || []).find((d) => (d.alias || '').toLowerCase() === alias.toLowerCase());
    if (!dir) {
      throw new Error(`Alias "@${alias}" is not authorized. Please authorize it in Security settings.`);
    }
    const abs = joinAbsoluteAndRelative(dir.path, aliasParsed.relative);
    const rel = computeRelativePath({ absolutePath: abs, directoryPath: dir.path });
    return { absolutePath: abs, directory: dir, relativePath: rel, viaAlias: true };
  }

  // absolute path
  const abs = normalizeAbsolutePath(raw);
  if (!abs) {
    throw new Error('Only absolute paths or @Alias/... paths are allowed');
  }
  const matched = findBestMatchingDirectory(abs, params.directories || []);
  if (!matched) {
    return { absolutePath: abs };
  }
  return {
    absolutePath: abs,
    directory: matched,
    relativePath: computeRelativePath({ absolutePath: abs, directoryPath: matched.path }),
    viaAlias: false,
  };
}

export function isOperationAllowed(dir: AllowlistDirectory | undefined, op: FileOp): boolean {
  if (!dir) return false;
  return !!dir.permissions?.[op];
}

