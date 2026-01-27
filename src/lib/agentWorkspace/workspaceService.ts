/**
 * Agent 会话工作区（默认 AppData）
 *
 * 目标：
 * - 让脚本/中间文件/产物有稳定落点，避免写到 skills 目录或用户 Documents
 * - 通过 conversationAttachmentStore 注入 @WorkDir，供 filesystem/shell_executor 默认使用
 *
 * 目录结构：
 * appDataDir()/workspaces/<conversationId>/
 *  - work/  脚本与临时文件
 *  - out/   产物
 *  - logs/  日志与校验摘要
 *  - manifest.json  本次会话产物/脚本/命令清单（最小骨架）
 */

export type ConversationWorkspace = {
  root: string;
  workDir: string;
  outDir: string;
  logsDir: string;
  manifestPath: string;
};

function normalize(p: string): string {
  return String(p || '').trim().replace(/\\/g, '/');
}

export async function getConversationWorkspaceRoot(conversationId: string): Promise<string> {
  const cid = String(conversationId || '').trim();
  if (!cid) throw new Error('conversationId is required');

  const { appDataDir, join } = await import('@tauri-apps/api/path');
  const base = await appDataDir();
  const root = await join(base, 'workspaces', cid);
  return normalize(root);
}

export async function ensureConversationWorkspace(conversationId: string): Promise<ConversationWorkspace> {
  const root = await getConversationWorkspaceRoot(conversationId);

  const { join } = await import('@tauri-apps/api/path');
  const { mkdir, exists, writeTextFile } = await import('@tauri-apps/plugin-fs');

  const workDir = normalize(await join(root, 'work'));
  const outDir = normalize(await join(root, 'out'));
  const logsDir = normalize(await join(root, 'logs'));
  const manifestPath = normalize(await join(root, 'manifest.json'));

  // 确保目录存在
  await mkdir(root, { recursive: true });
  await mkdir(workDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  // 最小 manifest：仅在不存在时创建，避免覆盖用户/历史数据
  try {
    const has = await exists(manifestPath);
    if (!has) {
      const now = Date.now();
      const manifest = {
        version: 1,
        conversationId,
        createdAt: now,
        updatedAt: now,
        notes: 'Auto-generated workspace manifest',
        scripts: [] as Array<{ path: string; purpose?: string; createdAt: number }>,
        commands: [] as Array<{ command: string; workingDir?: string; createdAt: number }>,
        inputs: [] as Array<{ path: string; description?: string }>,
        outputs: [] as Array<{ path: string; description?: string }>,
      };
      await writeTextFile(manifestPath, JSON.stringify(manifest, null, 2));
    }
  } catch {
    // ignore
  }

  return { root, workDir, outDir, logsDir, manifestPath };
}

export async function copyDirectoryRecursive(
  sourceDir: string,
  destinationDir: string
): Promise<{ filesCopied: number; dirsCreated: number }> {
  const src = normalize(sourceDir);
  const dst = normalize(destinationDir);
  if (!src || !dst) throw new Error('sourceDir and destinationDir are required');

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

export async function removeConversationWorkspace(conversationId: string): Promise<void> {
  const root = await getConversationWorkspaceRoot(conversationId);
  const { remove, exists } = await import('@tauri-apps/plugin-fs');
  try {
    if (await exists(root)) {
      await remove(root, { recursive: true });
    }
  } catch {
    // ignore
  }
}

export async function clearAllWorkspaces(): Promise<void> {
  const { appDataDir, join } = await import('@tauri-apps/api/path');
  const { remove, mkdir, exists } = await import('@tauri-apps/plugin-fs');
  const base = normalize(await join(await appDataDir(), 'workspaces'));
  try {
    if (await exists(base)) {
      await remove(base, { recursive: true });
    }
  } catch {
    // ignore
  }
  try {
    await mkdir(base, { recursive: true });
  } catch {
    // ignore
  }
}

