import { invoke } from '@tauri-apps/api/core';
import { isAndroidTauri } from '@/lib/utils/runtimePlatform';

export type AndroidDirectoryFolder = { handle: string; name: string };
export type AndroidDirectorySelection =
  | { status: 'ready'; folder: AndroidDirectoryFolder }
  | { status: 'none' | 'revoked' | 'unavailable' };

export function getAndroidDirectorySelection(conversationId: string) {
  return invoke<AndroidDirectorySelection>('android_directory_selection', {
    conversationId,
  });
}

export function pickAndroidDirectory(conversationId: string) {
  return invoke<AndroidDirectorySelection | { status: 'cancelled' }>(
    'pick_android_directory',
    { conversationId },
  );
}

export function forgetAndroidDirectory(conversationId: string) {
  return invoke<AndroidDirectorySelection>('forget_android_directory', {
    conversationId,
  });
}

export async function hasAndroidDirectorySelection(
  conversationId?: string,
): Promise<boolean> {
  if (!conversationId || !isAndroidTauri()) return false;
  try {
    return (
      (await getAndroidDirectorySelection(conversationId))?.status === 'ready'
    );
  } catch {
    return false;
  }
}
