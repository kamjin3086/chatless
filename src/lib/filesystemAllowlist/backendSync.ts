import type { AllowlistDirectory } from './types';
import { grantCallScope, revokeCallScope, setAllowlist, type SetAllowlistParams } from '@/lib/tauri/filesystemCommands';

type BackendAllowlistDirectory = SetAllowlistParams['directories'][number];

let lastSyncedKey = '';
// Serialize updates so a later request cannot be overwritten by an earlier
// completion. The cache is only advanced after the native command acknowledges.
let syncQueue: Promise<void> = Promise.resolve();

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

  const run = syncQueue.then(async () => {
    // The acknowledged key may have moved while this call was queued. The
    // cache is checked here, not before enqueueing: a call made while another
    // update is in flight must still be applied last, even when its key
    // matches the older acknowledged state.
    if (key === lastSyncedKey) return;
    await setAllowlist({ directories: backendDirs, version: 1 });
    lastSyncedKey = key;
  });
  // Keep the chain usable after a rejection; the caller still sees its own
  // failure, and the next identical request retries instead of being skipped.
  syncQueue = run.catch(() => {});
  return run;
}

export type CallScopedGrant = {
  path: string;
  permissions: { read?: boolean; write?: boolean; create?: boolean; delete?: boolean };
};

/** A registration that never answers must fail the call instead of hanging it. */
const GRANT_REGISTRATION_TIMEOUT_MS = 15_000;

function settleWithin<T>(
  registrations: Promise<T>[],
  timeoutMs: number,
): Promise<PromiseSettledResult<T>[] | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  return Promise.race([Promise.allSettled(registrations), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

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
  const revokeScope = async (): Promise<void> => {
    await revokeCallScope({ runId: scope.runId, callId: scope.callId }).catch(() => {});
  };
  const registrations = grants.map((grant) => grantCallScope({
    runId: scope.runId,
    callId: scope.callId,
    path: grant.path,
    read: !!grant.permissions.read,
    write: !!grant.permissions.write,
    create: !!grant.permissions.create,
    delete: !!grant.permissions.delete,
  }));
  // Settle every registration before deciding. A failing request must not race
  // a still-pending grant that would otherwise outlive the failure with no
  // revoker, so cleanup runs only after the whole scope has settled.
  const results = await settleWithin(registrations, GRANT_REGISTRATION_TIMEOUT_MS);
  if (results === 'timeout') {
    // A registration that lands after the timeout must not outlive the failed
    // call either; revoke again when the last attempt settles.
    void Promise.allSettled(registrations).then(() => revokeScope());
    await revokeScope();
    throw new Error(`call-scope registration timed out after ${GRANT_REGISTRATION_TIMEOUT_MS}ms`);
  }
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) {
    await revokeScope();
    const reason = (failed as PromiseRejectedResult).reason;
    throw reason instanceof Error ? reason : new Error(String(reason));
  }
  return revokeScope;
}

