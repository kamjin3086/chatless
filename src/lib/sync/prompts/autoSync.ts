/**
 * 自动同步模块
 * 当数据发生变化时，延迟触发 WebDAV 同步
 */

import { useWebDavSyncStore } from '@/store/webDavSyncStore';

const AUTO_SYNC_DELAY_MS = 5000; // 5秒防抖延迟
let syncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 触发自动同步
 * 使用防抖机制，在最后一次调用后 5 秒执行同步
 */
export function triggerPromptSync(): void {
  const cfg = useWebDavSyncStore.getState();
  
  // 检查是否启用自动同步
  if (!cfg.enabled || !cfg.autoSync) {
    return;
  }

  // 检查配置是否完整
  if (!cfg.url.trim() || !cfg.username.trim() || !cfg.password.trim()) {
    return;
  }

  // 清除之前的定时器
  if (syncTimer) {
    clearTimeout(syncTimer);
  }

  // 设置新的定时器
  syncTimer = setTimeout(async () => {
    await executeAutoSync();
  }, AUTO_SYNC_DELAY_MS);
}

/**
 * 执行自动同步
 * 使用新的通用同步框架
 */
async function executeAutoSync(): Promise<void> {
  const cfg = useWebDavSyncStore.getState();
  
  // 再次检查配置
  if (!cfg.enabled || !cfg.autoSync) {
    return;
  }

  // 检查是否正在同步中
  if (cfg.syncStatus === 'syncing') {
    return;
  }

  // 使用 store 中的 performSync 方法执行同步
  await cfg.performSync('both');
}

/**
 * 取消待执行的自动同步
 */
export function cancelPendingSync(): void {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
}

/**
 * 检查是否有待执行的同步
 */
export function hasPendingSync(): boolean {
  return syncTimer !== null;
}

/**
 * 检查是否正在同步中
 */
export function isSyncInProgress(): boolean {
  return useWebDavSyncStore.getState().syncStatus === 'syncing';
}
