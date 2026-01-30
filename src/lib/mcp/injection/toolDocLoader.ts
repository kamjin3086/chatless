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

// ================================
// 追问提示词加载
// ================================

/**
 * 追问提示词类型
 */
export type FollowUpPromptType = 'first' | 'first_error' | 'forced';

/**
 * 获取追问阶段的提示词
 */
export async function getFollowUpPrompt(type: FollowUpPromptType): Promise<string> {
  const cacheKey = `followup_${type}`;
  
  const hit = _cache.get(cacheKey);
  if (hit) {
    return await hit;
  }

  const p = (async () => {
    switch (type) {
      case 'first':
      case 'first_error':
        return await fetchText('/tool-docs/followup_first.txt');
      case 'forced':
        return await fetchText('/tool-docs/followup_forced.txt');
      default:
        return '';
    }
  })();

  _cache.set(cacheKey, p);
  return await p;
}

/**
 * 构建第一次追问提示词
 */
export async function buildFirstFollowUpPromptFromDoc(
  originalQuestion: string,
  hasError?: boolean
): Promise<string> {
  const doc = await getFollowUpPrompt(hasError ? 'first_error' : 'first');
  
  // 从文档中提取相应部分
  if (hasError) {
    // 提取错误处理部分
    const errorSection = doc.includes('## When Tool Failed')
      ? doc.split('## When Tool Failed')[1]?.trim() || doc
      : doc;
    return `${errorSection}\n\n用户问题：${originalQuestion}`;
  } else {
    // 提取成功处理部分
    const successSection = doc.includes('## When Tool Succeeded')
      ? doc.split('## When Tool Succeeded')[1]?.split('## When Tool Failed')[0]?.trim() || doc
      : doc;
    return `${successSection}\n\n用户问题：${originalQuestion}`;
  }
}

/**
 * 构建强制回答提示词
 */
export async function buildForcedAnswerPromptFromDoc(
  originalQuestion: string
): Promise<string> {
  const doc = await getFollowUpPrompt('forced');
  return `${doc}\n\n用户问题：${originalQuestion}`;
}

