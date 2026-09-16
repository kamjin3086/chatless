const STORAGE_FILE = 'labs-settings.json';
const STORAGE_KEY = 'coding_pack_enabled';

export async function isCodingPackEnabled(): Promise<boolean> {
  try {
    const { StorageUtil } = await import('@/lib/storage');
    const value = await StorageUtil.getItem<boolean>(STORAGE_KEY, false, STORAGE_FILE);
    return value === true;
  } catch {
    return false;
  }
}

export async function setCodingPackEnabled(enabled: boolean): Promise<void> {
  const { StorageUtil } = await import('@/lib/storage');
  await StorageUtil.setItem(STORAGE_KEY, enabled, STORAGE_FILE);
}
