import { isAndroidTauri } from '@/lib/utils/runtimePlatform';

export type AndroidPhotoBatchItem = {
  handle: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  contentDigest: string | null;
};

export type AndroidPhotoBatchOmission = {
  reason: 'unreadable' | 'item_limit' | string;
  name?: string;
};

export type AndroidPhotoBatchSelection =
  | { status: 'ready'; count: number }
  | { status: 'none' | 'cancelled' | 'unavailable' | 'busy' };

export type AndroidPhotoBatchInventory =
  | {
      status: 'ready';
      count: number;
      items: AndroidPhotoBatchItem[];
      omissions: AndroidPhotoBatchOmission[];
    }
  | { status: 'none' | 'unavailable' };

type PhotoBatchRequest = { conversationId: string };
type NativeInvoke<T> = (command: string, args: PhotoBatchRequest) => Promise<T>;

async function invokePhotoBatch<T>(
  command: string,
  args: PhotoBatchRequest,
): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

// One picker interaction per batch. The native side keeps the selection itself,
// so no Android URI crosses this boundary a second time.
export function pickAndroidPhotoBatch(
  conversationId: string,
  native: NativeInvoke<AndroidPhotoBatchSelection> = invokePhotoBatch,
) {
  return native('pick_android_photo_batch', { conversationId });
}

export function getAndroidPhotoBatchSelection(
  conversationId: string,
  native: NativeInvoke<AndroidPhotoBatchSelection> = invokePhotoBatch,
) {
  return native('android_photo_batch_selection', { conversationId });
}

export function forgetAndroidPhotoBatch(
  conversationId: string,
  native: NativeInvoke<AndroidPhotoBatchSelection> = invokePhotoBatch,
) {
  return native('forget_android_photo_batch', { conversationId });
}

export function inventoryAndroidPhotoBatch(
  conversationId: string,
  native: NativeInvoke<AndroidPhotoBatchInventory> = invokePhotoBatch,
) {
  return native('inventory_android_photo_batch', { conversationId });
}

export async function hasAndroidPhotoBatchSelection(
  conversationId?: string,
): Promise<boolean> {
  if (!conversationId || !isAndroidTauri()) return false;
  try {
    return (
      (await getAndroidPhotoBatchSelection(conversationId))?.status === 'ready'
    );
  } catch {
    return false;
  }
}
