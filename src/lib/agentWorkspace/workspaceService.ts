/**
 * Agent 会话工作目录（@WorkDir）。
 *
 * 设计目标：用户能在自己的文件系统里找到 AI 产物，而不是在应用数据目录里翻。
 *
 * 目录结构：文档/Chatless/<标题>-<会话ID前6位>/
 *  - 这个目录本身就是该会话的 @WorkDir（读写、相对路径都落在它里面）
 *  - manifest.json 记录本次会话用过的命令与产物，便于事后追溯
 *
 * 旧数据：升级前的工作区在应用数据目录（AppData/workspaces/<id>）。这里不迁移、
 * 不删除，只是**继续沿用**——已有会话仍然指向它们原来的目录。
 */

export type ConversationWorkspace = {
  /** 会话工作目录（@WorkDir）。 */
  root: string;
  manifestPath: string;
};

/** 目录名最大长度，避免超长标题制造麻烦。 */
const MAX_SLUG_CHARS = 40;

function normalize(p: string): string {
  return String(p || '').trim().replace(/\\/g, '/');
}

/** 会话 ID 的可读短标识，用于目录名去重与找回。 */
export function shortConversationId(conversationId: string): string {
  return String(conversationId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) || 'session';
}

/** 把会话标题变成安全的目录名片段。 */
export function sanitizeConversationSlug(title: string): string {
  const cleaned = String(title || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  if (!cleaned) return '会话';
  return Array.from(cleaned).slice(0, MAX_SLUG_CHARS).join('').trim() || '会话';
}

/** 会话目录名：标题 + 短 ID（短 ID 保证唯一且能被找回）。 */
export function workspaceFolderName(title: string, conversationId: string): string {
  return `${sanitizeConversationSlug(title)}-${shortConversationId(conversationId)}`;
}

/** 所有新会话工作区的根目录：文档/Chatless。 */
export async function getChatlessWorkspaceRoot(): Promise<string> {
  const { documentDir, homeDir, join } = await import('@tauri-apps/api/path');
  let documents = '';
  try {
    documents = await documentDir();
  } catch {
    // 某些环境下没有“文档”目录，退回用户主目录
  }
  if (!documents) {
    try {
      documents = await join(await homeDir(), 'Documents');
    } catch {
      documents = await homeDir();
    }
  }
  return normalize(await join(documents, 'Chatless'));
}

/** 旧版工作区（应用数据目录）——只在会话已经拥有它时继续沿用。 */
async function legacyWorkspaceRoot(conversationId: string): Promise<string> {
  const { appDataDir, join } = await import('@tauri-apps/api/path');
  return normalize(await join(await appDataDir(), 'workspaces', conversationId));
}

async function pathExists(p: string): Promise<boolean> {
  try {
    const { exists } = await import('@tauri-apps/plugin-fs');
    return await exists(p);
  } catch {
    return false;
  }
}

async function readDirNames(dir: string): Promise<string[]> {
  try {
    const { readDir } = await import('@tauri-apps/plugin-fs');
    const entries = await readDir(dir);
    return (entries || []).map((entry: any) => String(entry?.name || '')).filter(Boolean);
  } catch {
    return [];
  }
}

/** 目录里除了 manifest.json 之外还没有任何内容——只有这种目录允许改名。 */
async function isPristineWorkspace(root: string): Promise<boolean> {
  const names = await readDirNames(root);
  return names.every((name) => name === 'manifest.json');
}

async function writeManifestIfMissing(conversationId: string, manifestPath: string): Promise<void> {
  try {
    const { exists, writeTextFile } = await import('@tauri-apps/plugin-fs');
    if (await exists(manifestPath)) return;
    const now = Date.now();
    await writeTextFile(manifestPath, JSON.stringify({
      version: 1,
      conversationId,
      createdAt: now,
      updatedAt: now,
      notes: 'This folder holds the files this chat produced. manifest.json lists the commands and outputs.',
      scripts: [],
      commands: [],
      inputs: [],
      outputs: [],
    }, null, 2));
  } catch {
    // 清单只是辅助信息，写失败不影响工作目录可用
  }
}

/**
 * 解析（必要时创建）一个会话的工作目录。
 *
 * 顺序：已记住的目录 → 文档/Chatless 下按短 ID 找回 → 旧版应用数据目录 → 新建。
 * 旧目录一律沿用，不迁移、不删除。
 */
export async function ensureConversationWorkspace(params: {
  conversationId: string;
  title?: string;
  /** 已知的当前目录（通常来自会话状态），优先使用。 */
  knownRoot?: string;
}): Promise<ConversationWorkspace> {
  const cid = String(params.conversationId || '').trim();
  if (!cid) throw new Error('conversationId is required');

  const { join } = await import('@tauri-apps/api/path');
  const { mkdir } = await import('@tauri-apps/plugin-fs');
  const root = await getChatlessWorkspaceRoot();

  let dir = normalize(params.knownRoot || '');
  if (dir && !(await pathExists(dir))) dir = '';

  if (!dir) {
    // 已经存在于新根目录（按短 ID 找回），或沿用旧版目录
    const shortId = shortConversationId(cid);
    const existing = (await readDirNames(root)).find((name) => name.endsWith(`-${shortId}`));
    if (existing) {
      dir = normalize(await join(root, existing));
    } else {
      const legacy = await legacyWorkspaceRoot(cid);
      if (await pathExists(legacy)) dir = legacy;
    }
  }

  if (!dir) {
    const name = workspaceFolderName(params.title || '', cid);
    let candidate = normalize(await join(root, name));
    try {
      await mkdir(root, { recursive: true });
      await mkdir(candidate, { recursive: true });
    } catch {
      const unique = workspaceFolderName(`${params.title || ''} ${Date.now().toString(36)}`, cid);
      candidate = normalize(await join(root, unique));
      await mkdir(candidate, { recursive: true });
    }
    dir = candidate;
  }

  const manifestPath = normalize(await join(dir, 'manifest.json'));
  await writeManifestIfMissing(cid, manifestPath);
  return { root: dir, manifestPath };
}

/**
 * 标题变化后把「还没开始用」的目录改名，让它与标题一致。
 * 只要目录里已经出现过任何产物就不再改名：路径一旦交给模型就要保持稳定。
 */
export async function renameConversationWorkspaceIfPristine(params: {
  conversationId: string;
  currentRoot: string;
  title?: string;
}): Promise<string> {
  const cid = String(params.conversationId || '').trim();
  const current = normalize(params.currentRoot || '');
  if (!cid || !current) return current;

  const root = await getChatlessWorkspaceRoot();
  // 只改新根目录下的会话目录；旧版目录保持原样。
  if (!current.startsWith(`${normalize(root)}/`)) return current;
  const desired = normalize(await (await import('@tauri-apps/api/path')).join(root, workspaceFolderName(params.title || '', cid)));
  if (desired === current) return current;
  if (!(await pathExists(current)) || await pathExists(desired)) return current;
  if (!(await isPristineWorkspace(current))) return current;

  try {
    const { rename } = await import('@tauri-apps/plugin-fs');
    await rename(current, desired);
    return desired;
  } catch {
    return current;
  }
}

export async function copyDirectoryRecursive(
  sourceDir: string,
  destinationDir: string
): Promise<{ filesCopied: number; dirsCreated: number }> {
  const src = normalize(sourceDir);
  const dst = normalize(destinationDir);
  if (!src || !dst) throw new Error('sourceDir and destinationDir are required');
  if (normalize(src) === normalize(dst)) return { filesCopied: 0, dirsCreated: 0 };

  const { mkdir, readDir, copyFile } = await import('@tauri-apps/plugin-fs');
  await mkdir(dst, { recursive: true });

  let filesCopied = 0;
  let dirsCreated = 1;

  const entries = await readDir(src);
  for (const e of entries || []) {
    const ep = normalize((e as any)?.path || '');
    if (!ep) continue;
    const name = String((e as any)?.name || '').trim();
    const target = name ? `${dst}/${name}` : '';
    if (!target) continue;

    if ((e as any)?.isDirectory) {
      const r = await copyDirectoryRecursive(ep, target);
      filesCopied += r.filesCopied;
      dirsCreated += r.dirsCreated;
    } else if ((e as any)?.isFile) {
      await copyFile(ep, target);
      filesCopied += 1;
    }
  }

  return { filesCopied, dirsCreated };
}

/** 删除一个会话工作目录（用户显式清理）。 */
export async function removeConversationWorkspace(root: string): Promise<void> {
  const dir = normalize(root);
  if (!dir) return;
  try {
    const { remove, exists } = await import('@tauri-apps/plugin-fs');
    if (await exists(dir)) await remove(dir, { recursive: true });
  } catch {
    // ignore
  }
}

/**
 * 清空新根目录下的所有工作区。
 * 旧版应用数据目录里的历史工作区不在清理范围内（升级前的产物保持原样）。
 */
export async function clearAllWorkspaces(): Promise<void> {
  const root = await getChatlessWorkspaceRoot();
  try {
    const { remove, mkdir, exists } = await import('@tauri-apps/plugin-fs');
    if (await exists(root)) await remove(root, { recursive: true });
    await mkdir(root, { recursive: true });
  } catch {
    // ignore
  }
}
