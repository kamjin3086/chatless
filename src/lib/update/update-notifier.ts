import StorageUtil from "@/lib/storage";

// 简化：仅持久化"忽略版本"。移除所有时间限制，改为基于用户明确操作的交互设计
const STORE = "updates.json";
export const UPDATE_AVAILABILITY_EVENT = 'chatless-update-availability-changed';
// Keep the persisted ignore identity for updates that don't report a version.
export const UNKNOWN_UPDATE_VERSION = '新版本';

const KEY_IGNORED_VERSION = "ignored_version"; // string

// 仅依赖 Tauri Updater 插件进行检查；不再进行任何自定义网络请求兜底

export interface UpdateAvailability {
  available: boolean;
  version?: string | null;
  body?: string;
}

// 单航班锁：避免在启动阶段或设置页并发触发多次插件检查
let inFlightCheck: Promise<UpdateAvailability> | null = null;

export async function getUpdateAvailability(): Promise<UpdateAvailability> {
  try {
    if (typeof window === "undefined") {
      return { available: false };
    }
    const { check } = await import("@tauri-apps/plugin-updater");
    const result = await check({ timeout: 20_000 });
    console.log('[update-notifier] getUpdateAvailability: plugin result', result);
    if (result && (result as any).available) {
      const versionRaw: any = (result as any).version;
      const version: string | null = typeof versionRaw === 'string' && versionRaw.length > 0 ? versionRaw : UNKNOWN_UPDATE_VERSION;
      return { available: true, version, body: result.body };
    }
    return { available: false };
  } catch {
    return { available: false };
  }
}

// 已移除：setUpdateAvailable/clearUpdateAvailable（不再持久化可用版本）

// 关于页蓝点：简化为“有更新 且 未被忽略”
export async function shouldShowAboutBlueDot(): Promise<boolean> {
  const availability = await getUpdateAvailability();
  if (!availability.available) return false;
  try {
    const ignored = await isVersionIgnored(availability.version);
    if (ignored) return false;
  } catch { /* noop */ }
  return true;
}

export async function checkForUpdatesSilently(): Promise<UpdateAvailability> {
  // 并发合并：若已有检查在进行，复用同一 Promise
  if (inFlightCheck) return inFlightCheck;

  const doCheck = async (): Promise<UpdateAvailability> => {
    try {
      // 非浏览器环境直接返回无更新
      if (typeof window === "undefined") {
        return { available: false };
      }

      const { check } = await import("@tauri-apps/plugin-updater");
      const result = await check({ timeout: 20_000 });
      console.log('[update-notifier] silent check: plugin result', result);

      if (result && (result as any).available) {
        const versionRaw: any = (result as any).version;
        const version: string = typeof versionRaw === 'string' && versionRaw.length > 0 ? versionRaw : UNKNOWN_UPDATE_VERSION;
        const availability: UpdateAvailability = { available: true, version, body: result.body };
        try {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(UPDATE_AVAILABILITY_EVENT, { detail: availability }));
          }
        } catch { /* noop */ }
        return availability;
      }
      return { available: false };
    } catch (error) {
      console.error('[update-notifier] check failed:', error);
      return { available: false };
    }
  };

  inFlightCheck = doCheck();
  try {
    return await inFlightCheck;
  } finally {
    inFlightCheck = null;
  }
}

export function scheduleBackgroundUpdateChecks(): void {
  // 启动后立即检查一次。若失败，在 5s 后补一次。
  let firstAttemptSucceeded = false;
  checkForUpdatesSilently()
    .then(() => { firstAttemptSucceeded = true; })
    .catch(() => {});
  setTimeout(() => {
    if (!firstAttemptSucceeded) {
      checkForUpdatesSilently().catch(() => {});
    }
  }, 5_000);

  // 每 24 小时定时检查一次（仅用于发现新版本，不会自动弹窗，除非用户未忽略）
  setInterval(() => {
    checkForUpdatesSilently().catch(() => {});
  }, 24 * 60 * 60 * 1000); // 24小时
}

// 已移除版本比较与自定义端点兜底逻辑，完全依赖 Tauri 插件

// ===== 忽略版本（用户选择不再提示当前版本） =====
export async function getIgnoredVersion(): Promise<string | null> {
  return StorageUtil.getItem<string>(KEY_IGNORED_VERSION, null, STORE);
}

export async function setIgnoredVersion(version: string): Promise<void> {
  await StorageUtil.setItem(KEY_IGNORED_VERSION, version, STORE);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(UPDATE_AVAILABILITY_EVENT));
  }
}

export async function clearIgnoredVersion(): Promise<void> {
  await StorageUtil.removeItem(KEY_IGNORED_VERSION, STORE);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(UPDATE_AVAILABILITY_EVENT));
  }
}

export async function isVersionIgnored(version: string | null | undefined): Promise<boolean> {
  if (!version) return false;
  const ignored = await getIgnoredVersion();
  return !!ignored && ignored === version;
}


