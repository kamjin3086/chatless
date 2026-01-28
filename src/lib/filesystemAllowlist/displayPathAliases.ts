import { useChatStore } from '@/store/chatStore';
import { useConversationAttachmentStore } from '@/store/conversationAttachmentStore';
import { useFilesystemAllowlistStore } from '@/store/filesystemAllowlistStore';

function normalizePath(p: string): string {
  return String(p || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '');
}

function joinPath(base: string, rest: string): string {
  const b = normalizePath(base);
  const r = String(rest || '').trim().replace(/\\/g, '/');
  if (!r) return b;
  return `${b}/${r.replace(/^\/+/, '')}`;
}

function findConversationIdForMessage(messageId: string): string | null {
  const mid = String(messageId || '').trim();
  if (!mid) return null;
  try {
    const st = useChatStore.getState();
    for (const c of st.conversations || []) {
      const msgs: any[] = Array.isArray((c as any).messages) ? (c as any).messages : [];
      if (msgs.some((m) => m?.id === mid)) return String((c as any).id || '');
    }
  } catch {
    // ignore
  }
  return null;
}

function buildAliasMap(params?: { conversationId?: string; messageId?: string }): Map<string, string> {
  const map = new Map<string, string>();

  // 1) Allowlist aliases（用户手动设置的 @Alias）
  try {
    const dirs = useFilesystemAllowlistStore.getState().directories || [];
    for (const d of dirs) {
      const alias = typeof (d as any)?.alias === 'string' ? String((d as any).alias) : '';
      const path = typeof (d as any)?.path === 'string' ? String((d as any).path) : '';
      if (!alias || !path) continue;
      map.set(alias.toLowerCase(), normalizePath(path));
    }
  } catch {
    // ignore
  }

  // 2) 会话级 @WorkDir
  try {
    const convId =
      String(params?.conversationId || '').trim() ||
      (params?.messageId ? findConversationIdForMessage(params.messageId) : null) ||
      useChatStore.getState().currentConversationId ||
      '';
    if (convId) {
      const wd = useConversationAttachmentStore.getState().getWorkingDir(convId);
      if (wd) map.set('workdir', normalizePath(String(wd)));
    }
  } catch {
    // ignore
  }

  return map;
}

/**
 * 解析 `@WorkDir/...` 或 `@Alias/...` 为绝对路径（若可解析）。
 * - 若不是 @ 前缀路径，直接做轻量规范化返回
 * - 若无法解析别名，则返回规范化后的原字符串
 */
export function resolveAliasPath(params: {
  path: string;
  conversationId?: string;
  messageId?: string;
}): string {
  const raw = String(params.path || "").trim();
  if (!raw) return "";
  const p = raw.replace(/\\/g, "/");

  const m = p.match(/^@([a-zA-Z0-9_-]+)[/\\](.*)$/);
  if (!m) {
    return normalizePath(p);
  }
  const alias = m[1];
  const rest = m[2] || "";
  const aliasMap = buildAliasMap({ conversationId: params.conversationId, messageId: params.messageId });
  const base = aliasMap.get(String(alias || "").toLowerCase());
  if (!base) return normalizePath(p);
  return joinPath(base, rest);
}

/**
 * 将文内出现的 `@WorkDir/...` / `@Alias/...` 转为 **绝对路径**，并用 Markdown 行内代码高亮：
 * - 只在「非 fenced code / 非 inline code」区域生效，避免篡改代码块内容
 * - 无法解析的别名将保持原样
 */
export function replaceAliasPathsForDisplay(markdown: string): string {
  const input = String(markdown || '');
  if (!input) return '';

  const aliasMap = buildAliasMap();
  if (aliasMap.size === 0) return input;

  const tryResolve = (alias: string, rest: string): string | null => {
    const base = aliasMap.get(String(alias || '').toLowerCase());
    if (!base) return null;
    const abs = joinPath(base, rest);
    return abs;
  };

  const MAX_TOKEN_LEN = 800;
  const isPathChar = (ch: string) => !/\s/.test(ch) && !/[)\]}>"'`,]/.test(ch);

  let out = '';
  let i = 0;
  let inFence = false;
  let inInline = false;

  while (i < input.length) {
    if (!inInline && input.startsWith('```', i)) {
      inFence = !inFence;
      out += '```';
      i += 3;
      continue;
    }
    const ch = input[i];
    if (!inFence && ch === '`') {
      inInline = !inInline;
      out += '`';
      i += 1;
      continue;
    }

    if (!inFence && !inInline && ch === '@') {
      // parse alias
      let j = i + 1;
      while (j < input.length && /[a-zA-Z0-9_-]/.test(input[j] || '')) j += 1;
      const alias = input.slice(i + 1, j);
      const sep = input[j] || '';
      if (alias && (sep === '/' || sep === '\\')) {
        let k = j + 1;
        let len = 0;
        while (k < input.length && isPathChar(input[k] || '') && len < MAX_TOKEN_LEN) {
          k += 1;
          len += 1;
        }
        const rest = input.slice(j + 1, k);
        const abs = tryResolve(alias, rest);
        if (abs) {
          out += `\`${abs}\``;
          i = k;
          continue;
        }
      }
    }

    out += ch;
    i += 1;
  }

  return out;
}

export function replaceAliasPathsForDisplayWithContext(params: {
  markdown: string;
  conversationId?: string;
  messageId?: string;
}): string {
  const input = String(params.markdown || '');
  if (!input) return '';
  const aliasMap = buildAliasMap({ conversationId: params.conversationId, messageId: params.messageId });
  if (aliasMap.size === 0) return input;

  // 复用同一套逻辑：用临时 map 覆盖 buildAliasMap 结果
  const tryResolve = (alias: string, rest: string): string | null => {
    const base = aliasMap.get(String(alias || '').toLowerCase());
    if (!base) return null;
    const abs = joinPath(base, rest);
    return abs;
  };

  const MAX_TOKEN_LEN = 800;
  const isPathChar = (ch: string) => !/\s/.test(ch) && !/[)\]}>"'`,]/.test(ch);

  let out = '';
  let i = 0;
  let inFence = false;
  let inInline = false;

  while (i < input.length) {
    if (!inInline && input.startsWith('```', i)) {
      inFence = !inFence;
      out += '```';
      i += 3;
      continue;
    }
    const ch = input[i];
    if (!inFence && ch === '`') {
      inInline = !inInline;
      out += '`';
      i += 1;
      continue;
    }

    if (!inFence && !inInline && ch === '@') {
      let j = i + 1;
      while (j < input.length && /[a-zA-Z0-9_-]/.test(input[j] || '')) j += 1;
      const alias = input.slice(i + 1, j);
      const sep = input[j] || '';
      if (alias && (sep === '/' || sep === '\\')) {
        let k = j + 1;
        let len = 0;
        while (k < input.length && isPathChar(input[k] || '') && len < MAX_TOKEN_LEN) {
          k += 1;
          len += 1;
        }
        const rest = input.slice(j + 1, k);
        const abs = tryResolve(alias, rest);
        if (abs) {
          out += `\`${abs}\``;
          i = k;
          continue;
        }
      }
    }

    out += ch;
    i += 1;
  }

  return out;
}

