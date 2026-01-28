import type { AllowlistDirectory } from './types';

type BackendAllowlistDirectory = {
  path: string;
  permissions: {
    read: boolean;
    write: boolean;
    create: boolean;
    delete: boolean;
  };
};

let lastSyncedKey = '';

function toBackendDir(d: AllowlistDirectory): BackendAllowlistDirectory {
  return {
    path: d.path,
    permissions: {
      read: !!d.permissions?.read,
      write: !!d.permissions?.write,
      create: !!d.permissions?.create,
      delete: !!d.permissions?.delete,
    },
  };
}

/**
 * 同步 allowlist 到 Rust 后端（后端做最终校验）。
 * 做了轻量去重，避免每次 tool call 都触发 invoke。
 */
export async function syncFilesystemAllowlistToBackend(directories: AllowlistDirectory[]): Promise<void> {
  const backendDirs = (directories || []).map(toBackendDir);
  const key = JSON.stringify(backendDirs);
  if (key === lastSyncedKey) return;
  lastSyncedKey = key;

  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('filesystem_set_allowlist', { payload: { directories: backendDirs, version: 1 } });
}

