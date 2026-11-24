import { invoke } from '@tauri-apps/api/core';
import { isAndroidTauri } from '@/lib/utils/runtimePlatform';

/**
 * The folders this app holds a persistent read grant for.
 *
 * Android owns the grant list; this reads it back. Two questions are kept apart on purpose:
 * what the system lets the app touch, and what the user lets a model read from a conversation
 * they did not attach anything to. A folder with `agentEnabled` off stays authorized and is
 * simply absent from the tool.
 */
export type AndroidAuthorizedRoot = {
  uri: string;
  name: string;
  agentEnabled: boolean;
  /**
   * Whether the grant the person gave covers writing. Folders picked before writing existed are
   * readable only, and Android will not let the app add write on its own: they have to hand the
   * folder over again. Surfacing it here is what turns "写入失败" into a button.
   */
  writable: boolean;
};

export async function listAndroidAuthorizedRoots(): Promise<
  AndroidAuthorizedRoot[]
> {
  if (!isAndroidTauri()) return [];
  try {
    const reply = await invoke<{ roots?: AndroidAuthorizedRoot[] }>(
      'android_directory_roots',
    );
    return Array.isArray(reply?.roots) ? reply.roots : [];
  } catch {
    // A provider that will not answer leaves the list empty rather than an error screen.
    return [];
  }
}

export async function hasAndroidAuthorizedFolders(): Promise<boolean> {
  return (await listAndroidAuthorizedRoots()).some((root) => root.agentEnabled);
}

export async function setAndroidRootAgent(
  uri: string,
  agentEnabled: boolean,
): Promise<void> {
  await invoke('set_android_directory_root', { uri, agentEnabled });
}

export async function revokeAndroidRoot(uri: string): Promise<void> {
  await invoke('revoke_android_directory_root', { uri });
}

/**
 * Ask Android for write access to a folder the app can already read. The person picks the folder
 * again; a different one is reported rather than silently authorized.
 */
export async function authorizeAndroidDirectoryWrite(
  uri: string,
): Promise<'ready' | 'different' | 'refused' | 'cancelled' | 'unavailable'> {
  if (!isAndroidTauri()) return 'unavailable';
  try {
    const reply = await invoke<{ status?: string }>(
      'authorize_android_directory_write',
      { uri },
    );
    const status = reply?.status;
    return status === 'ready' ||
      status === 'different' ||
      status === 'refused' ||
      status === 'cancelled'
      ? status
      : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
