import type { AllowlistPermissions, AllowlistSource } from './types';
import { normalizeDirectoryPath } from './allowlist';

export async function ensureAllowlistedDirectory(params: {
  path: string;
  source: AllowlistSource;
  permissions: AllowlistPermissions;
  alias?: string;
  reconnect?: boolean;
}): Promise<void> {
  const dirPath = normalizeDirectoryPath(params.path);
  if (!dirPath) return;

  const { useFilesystemAllowlistStore } = await import('@/store/filesystemAllowlistStore');
  const st = useFilesystemAllowlistStore.getState();
  await st.load();

  // 优先按 path 去重；alias 只是可选展示
  const existing = st.getByPath(dirPath);
  if (existing) {
    await st.updateDirectory(existing.id, {
      permissions: params.permissions,
      source: params.source,
      ...(params.alias ? { alias: params.alias } : null),
    });
  } else {
    await st.addDirectory({
      path: dirPath,
      alias: params.alias,
      permissions: params.permissions,
      source: params.source,
    });
  }

  // 同步到 Rust 后端（后端为最终安全边界）
  try {
    const { syncFilesystemAllowlistToBackend } = await import('@/lib/filesystemAllowlist/backendSync');
    const dirs = useFilesystemAllowlistStore.getState().directories;
    await syncFilesystemAllowlistToBackend(dirs);
  } catch {
    // ignore
  }
}

