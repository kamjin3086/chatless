type ToolDocKey = string;

const _cache = new Map<ToolDocKey, Promise<string>>();

function normalizeKey(key: string): string {
  return String(key || '').trim().toLowerCase();
}

function truncateDoc(text: string, maxChars: number): string {
  const s = String(text || '').trim();
  if (!s) return '';
  if (!Number.isFinite(maxChars) || maxChars <= 0) return '';
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}\n\n...(truncated, ${s.length} chars)`;
}

async function fetchText(url: string): Promise<string> {
  // Runs in frontend; if not available (SSR), safely return empty.
  if (typeof fetch !== 'function') return '';
  const resp = await fetch(url, { cache: 'force-cache' as any }).catch(() => null as any);
  if (!resp || !resp.ok) return '';
  const txt = await resp.text().catch(() => '');
  return String(txt || '');
}

export async function getToolDoc(params: {
  /** e.g. 'filesystem__read_file' or 'shell_executor__execute_command' */
  toolFullName: string;
  /** max chars appended to tool description */
  maxChars?: number;
}): Promise<string> {
  const key = normalizeKey(params.toolFullName);
  if (!key) return '';

  const maxChars = typeof params.maxChars === 'number' ? params.maxChars : 3500;

  const hit = _cache.get(key);
  if (hit) {
    const t = await hit;
    return truncateDoc(t, maxChars);
  }

  const p = (async () => {
    // Map: tool -> doc file (public/)
    if (key === 'shell_executor__execute_command') {
      return await fetchText('/tool-docs/shell_executor_execute_command.txt');
    }
    if (key.startsWith('filesystem__')) {
      return await fetchText('/tool-docs/filesystem.txt');
    }
    if (key.startsWith('skills__')) {
      return await fetchText('/tool-docs/skills.txt');
    }
    return '';
  })();

  _cache.set(key, p);
  const t = await p;
  return truncateDoc(t, maxChars);
}

