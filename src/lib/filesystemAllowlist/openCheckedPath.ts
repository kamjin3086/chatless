/**
 * Opens a file or folder with the system default application.
 *
 * The renderer's `opener` plugin is scoped to fixed directories ($APPDATA), so
 * it cannot open a produced file in Documents/Chatless or a folder the user
 * attached. This goes through a Rust command that applies the same allowlist
 * check as a read, with a one-shot read grant for the exact path.
 */

export async function openCheckedPath(path: string): Promise<boolean> {
  const target = String(path || '').trim();
  if (!target) return false;
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return false;

  const runId = `ui-open:${Date.now()}`;
  const callId = `open-${Math.random().toString(16).slice(2)}`;
  let granted = false;
  try {
    const { grantCallScope, revokeCallScope, openPathChecked } = await import('@/lib/tauri/filesystemCommands');
    // The user is clicking a path this session already produced or mounted; the
    // grant is scoped to this one open and revoked immediately after.
    await grantCallScope({ runId, callId, path: target, read: true });
    granted = true;
    await openPathChecked(target);
    return true;
  } catch {
    return false;
  } finally {
    if (granted) {
      try {
        const { revokeCallScope } = await import('@/lib/tauri/filesystemCommands');
        await revokeCallScope({ runId, callId });
      } catch {
        // the grant expires on its own
      }
    }
  }
}
