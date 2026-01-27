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

  // 同步到 mcp_servers.json，并 best-effort 重连 filesystem
  try {
    const { setFilesystemAllowedDirectories } = await import('@/lib/mcp/filesystemServerConfig');
    const dirs = useFilesystemAllowlistStore.getState().directories.map((d) => d.path);
    await setFilesystemAllowedDirectories({ directories: dirs, reconnect: params.reconnect !== false });
  } catch {
    // ignore
  }
}

