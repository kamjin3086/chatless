import { listDirectory, readFile } from '@/lib/tauri/filesystemCommands';

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(/§§/g, '.*')
    .replace(/\?/g, '[^/\\\\]');
  return new RegExp(`^${escaped}$`, 'i');
}

export async function searchGlob(params: {
  root: string;
  pattern: string;
  limit?: number;
}): Promise<string[]> {
  const limit = Math.min(500, Math.max(1, params.limit ?? 200));
  const re = globToRegExp(params.pattern);
  const out: string[] = [];
  const queue: string[] = [params.root.replace(/\\/g, '/')];

  while (queue.length > 0 && out.length < limit) {
    const dir = queue.shift()!;
    const listing = await listDirectory({ path: dir, limit: 500 });
    const entries = Array.isArray((listing as any)?.entries) ? (listing as any).entries : [];
    for (const entry of entries) {
      const name = String(entry?.name || '');
      const full = `${dir.replace(/\/$/, '')}/${name}`;
      const rel = full.slice(params.root.length).replace(/^[/\\]/, '');
      if (entry?.isDirectory) {
        queue.push(full);
      }
      if (re.test(rel) || re.test(name)) {
        out.push(full);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

export async function searchGrep(params: {
  root: string;
  query: string;
  glob?: string;
  limit?: number;
}): Promise<Array<{ path: string; line: number; text: string }>> {
  const limit = Math.min(200, Math.max(1, params.limit ?? 100));
  const files = params.glob
    ? await searchGlob({ root: params.root, pattern: params.glob, limit: 300 })
    : await searchGlob({ root: params.root, pattern: '**/*', limit: 300 });
  const re = new RegExp(params.query, 'i');
  const matches: Array<{ path: string; line: number; text: string }> = [];

  for (const file of files) {
    if (matches.length >= limit) break;
    try {
      const content = await readFile({ path: file });
      const text = typeof (content as any)?.content === 'string' ? (content as any).content : String((content as any)?.data || '');
      const lines = text.split(/\r?\n/);
      lines.forEach((line: string, idx: number) => {
        if (matches.length >= limit) return;
        if (re.test(line)) {
          matches.push({ path: file, line: idx + 1, text: line.slice(0, 500) });
        }
      });
    } catch {
      // skip unreadable
    }
  }
  return matches;
}

export function previewPatch(params: { path: string; patch: string; mode?: 'diff' | 'replace' }) {
  const mode = params.mode || 'diff';
  if (mode === 'replace') {
    return {
      path: params.path,
      preview: params.patch,
      requiresApproval: true,
      note: '整文件替换预览；写入需用户审批',
    };
  }
  return {
    path: params.path,
    preview: params.patch,
    requiresApproval: true,
    note: 'diff 预览；请确认后使用 fs__write 或审批流程写入',
  };
}
