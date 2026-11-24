import { isAndroidTauri } from '@/lib/utils/runtimePlatform';
import {
  isFilesystemServer,
  isShellServer,
  normalizeServerName,
} from '../toolNaming';

/**
 * The desktop file layer and the process sandbox are not in the Android build at
 * all: `mobile.rs` registers neither the `filesystem_*` commands nor the process
 * ones. A call that gets that far fails while establishing its call-scoped grant,
 * which reads to the model like a bad path, so the phone neither advertises these
 * servers nor runs them.
 *
 * One predicate answers both halves, so a tool cannot come back on one side only.
 */
export function isMobileUnsupportedServer(server: string): boolean {
  const srv = normalizeServerName(server);
  return isFilesystemServer(srv) || isShellServer(srv);
}

/** Why the call is not available here, or `undefined` when it may run. */
export function mobileUnsupportedReason(
  server: string,
  tool: string,
): string | undefined {
  if (!isAndroidTauri() || !isMobileUnsupportedServer(server)) return undefined;
  const kind = isShellServer(normalizeServerName(server))
    ? 'shell'
    : 'filesystem';
  return (
    `This is an Android device: the ${kind} backend (${server}__${tool}) is not part of this build. ` +
    'Do not retry it with another path. Ask the user to attach the folder from the attachment ' +
    'menu, then read it with android_directory__inventory; photos and documents the chat ' +
    'already holds are under android_photos__group and android_document__search / __excerpt.'
  );
}
