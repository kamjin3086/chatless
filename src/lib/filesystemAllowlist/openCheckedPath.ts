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

  try {
    const { openPathChecked } = await import('@/lib/tauri/filesystemCommands');
    const { withOneShotGrant } = await import('@/lib/filesystemAllowlist/oneShotGrant');
    // The user is clicking a path this session already produced or mounted; the
    // grant is scoped to this one open and revoked immediately after.
    await withOneShotGrant({ path: target, scope: 'open', read: true }, () => openPathChecked(target));
    return true;
  } catch {
    return false;
  }
}
