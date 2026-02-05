import { v4 as uuidv4 } from 'uuid';
import StorageUtil from '@/lib/storage';

export const WEBDAV_SYNC_STORE = 'webdav-sync.json';
export const DEVICE_ID_STORAGE_KEY = 'device_id';

export async function getOrCreateSyncDeviceId(): Promise<string> {
  const existing = await StorageUtil.getItem<string>(DEVICE_ID_STORAGE_KEY, '', WEBDAV_SYNC_STORE);
  if (existing) return existing;
  const next = uuidv4();
  await StorageUtil.setItem(DEVICE_ID_STORAGE_KEY, next, WEBDAV_SYNC_STORE);
  return next;
}

