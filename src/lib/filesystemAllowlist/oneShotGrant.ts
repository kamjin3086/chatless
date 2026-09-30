/**
 * 一次操作授权：用户点了一个具体路径，就给这一次调用一个最小授权，用完立即撤销。
 *
 * 场景是"用户主动点击 UI 去读/写某个文件"（打开产物、查看历史、恢复版本）。
 * 这类动作不该写进持久白名单——那会让每个会话都往安全设置里塞条目，很快没法
 * 人工审计；也不该因为关掉菜单就失效，因为用户点的是当下这个文件。
 */

export async function withOneShotGrant<T>(
  params: { path: string; scope: string; read?: boolean; write?: boolean },
  work: () => Promise<T>,
): Promise<T> {
  const path = String(params.path || '').trim();
  if (!path) throw new Error('path is required');

  const { grantCallScope, revokeCallScope } = await import('@/lib/tauri/filesystemCommands');
  const runId = `ui-${params.scope}:${Date.now()}`;
  const callId = `call-${Math.random().toString(16).slice(2)}`;
  let granted = false;
  try {
    // Read is implied when only a write is asked for: every write路径 needs to
    // read the current content first (and to back it up).
    await grantCallScope({
      runId,
      callId,
      path,
      read: params.read !== false,
      write: !!params.write,
    });
    granted = true;
    return await work();
  } finally {
    if (granted) {
      try {
        await revokeCallScope({ runId, callId });
      } catch {
        // The grant expires on its own; failing to revoke must not hide the result.
      }
    }
  }
}
