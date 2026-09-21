import type { AllowlistDirectory } from './types';
import { grantCallScope, revokeCallScope, setAllowlist, type SetAllowlistParams } from '@/lib/tauri/filesystemCommands';

type BackendAllowlistDirectory = SetAllowlistParams['directories'][number];

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

  await setAllowlist({ directories: backendDirs, version: 1 });
}

export type CallScopedGrant = {
  path: string;
  permissions: { read?: boolean; write?: boolean; create?: boolean; delete?: boolean };
};

/**
 * Registers the grants for one executing call: the session working directory and
 * any single approval the user just gave. They live in backend memory only, are
 * bound to run and call, and are dropped by the returned revoker.
 */
export async function grantCallScopedPaths(
  grants: CallScopedGrant[],
  scope: { runId: string; callId?: string },
): Promise<() => Promise<void>> {
  if (!grants.length) return async () => {};
  await Promise.all(grants.map((grant) => grantCallScope({
    runId: scope.runId,
    callId: scope.callId,
    path: grant.path,
    read: !!grant.permissions.read,
    write: !!grant.permissions.write,
    create: !!grant.permissions.create,
    delete: !!grant.permissions.delete,
  })));
  return async () => {
    await revokeCallScope({ runId: scope.runId, callId: scope.callId }).catch(() => {});
  };
}

