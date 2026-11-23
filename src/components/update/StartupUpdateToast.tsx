"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { getUpdateAvailability, UPDATE_AVAILABILITY_EVENT, UNKNOWN_UPDATE_VERSION, isVersionIgnored, setIgnoredVersion, checkForUpdatesSilently, type UpdateAvailability } from "@/lib/update/update-notifier";
import { translate } from "@/i18n";
import { useTranslation } from "@/i18n/useTranslation";
import { linkOpener } from "@/lib/utils/linkOpener";
import { useLocaleStore } from "@/store/localeStore";
import { UpdateNotesPreview } from "./UpdateNotesPreview";

/**
 * 启动更新提示组件
 * - 启动后检测是否存在新版本，若有则在右下角以自定义Toast提示
 * - 提供“下载更新”按钮
 * - 提供“忽略此版本”勾选
 */
export function StartupUpdateToast() {
  const [onlyCheck, setOnlyCheck] = useState<boolean>(false);
  const timersRef = useRef<number[]>([]);

  // 优化体验：更合理的时间点
  // - 首次延迟检查：12s（避开首屏初始化高峰）
  // - 兜底二次检查：60s（若首次未检出或注入稍晚）
  const FIRST_DELAY_MS = 12_000;
  const SECOND_DELAY_MS = 60_000;

  // 初始化“仅检查更新”偏好
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // 优先读取全局标记（设置页会写入）
        const winAny: any = typeof window !== 'undefined' ? window : undefined;
        const flag = !!winAny?.__CHATLESS_ONLY_CHECK_UPDATE__;
        if (mounted) setOnlyCheck(flag);
        if (!flag) {
          // 若未设置全局标记，则尝试读取存储（避免首次未打开设置页时状态不准）
          const { default: StorageUtil } = await import("@/lib/storage");
          const saved = await StorageUtil.getItem<boolean>('only_check_update', false, 'user-preferences.json');
          if (mounted) setOnlyCheck(!!saved);
        }
      } catch {
        // noop
      }
    })();
    return () => { mounted = false; };
  }, []);

  const showToastFor = useCallback(async (version: string, body?: string) => {
    try {
      console.log('[StartupUpdateToast] showToastFor called with version:', version);
      if (await isVersionIgnored(version)) {
        console.log('[StartupUpdateToast] version ignored, skip showing toast');
        return; // 已被忽略则不提示
      }

      // 避免在极短时间内（1分钟）重复为相同版本弹多次
      // 但允许后续重新显示（比如用户只是关闭了弹窗）
      const now = Date.now();
      const lastShownKey = `last_shown_${version}`;
      const lastShown = (window as any)[lastShownKey] as number | undefined;
      if (lastShown && now - lastShown < 60_000) {
        console.log('[StartupUpdateToast] recently shown, skip');
        return;
      }
      (window as any)[lastShownKey] = now;

      const id = toast.raw(
        <UpdateAvailableNotice
          version={version}
          body={body}
          onlyCheck={onlyCheck}
          onDismiss={() => toast.raw.dismiss(id)}
        />,
        { duration: 60000 }
      );
    } catch (e) {
      console.warn('[StartupUpdateToast] showToastFor failed:', e);
    }
  }, [onlyCheck]);

  // 挂载后在更合理的时间点进行检查，并在必要时做一次兜底重试。
  useEffect(() => {
    let mounted = true;
    const waitUntilVisible = async (maxWaitMs: number) => {
      if (typeof document === 'undefined') return true;
      if (!document.hidden) return true;
      return await new Promise<boolean>((resolve) => {
        let resolved = false;
        const onChange = () => {
          if (!resolved && !document.hidden) {
            resolved = true;
            document.removeEventListener('visibilitychange', onChange);
            resolve(true);
          }
        };
        document.addEventListener('visibilitychange', onChange);
        const t = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            document.removeEventListener('visibilitychange', onChange);
            resolve(false);
          }
        }, maxWaitMs);
        timersRef.current.push(t as unknown as number);
      });
    };

    const scheduleCheck = (delayMs: number) => {
      const t = setTimeout(() => {
      (async () => {
        try {
          // 以动态导入判断插件是否可用，避免依赖 __TAURI__ 标志
          const waitUpdaterUsable = async () => {
            for (let i = 0; i < 15; i++) { // 最长 ~3s
              try {
                const { check } = await import('@tauri-apps/plugin-updater');
                if (typeof check === 'function') return true;
                 } catch { /* noop */ }
              await new Promise((r) => setTimeout(r, 200));
              if (!mounted) return false;
            }
            return false;
          };

          const ready = await waitUpdaterUsable();
          if (!mounted || !ready) return;

            // 若页面不可见，等待最多 5s 变为可见再检查，避免在后台被系统拦截通知
            await waitUntilVisible(5_000);

          const info = await checkForUpdatesSilently();
          if (!mounted) return;
          if (info.available && info.version) {
            await showToastFor(info.version, info.body);
          }
          } catch {
            // 静默失败即可，兜底二次检查仍会执行
          }
      })();
      }, delayMs);
      timersRef.current.push(t as unknown as number);
    };

    // 首次检查
    scheduleCheck(FIRST_DELAY_MS);
    // 兜底二次检查：若此时仍未提示（例如插件注入极晚），再检查一次
    scheduleCheck(SECOND_DELAY_MS);

    return () => {
      mounted = false;
      for (const t of timersRef.current.splice(0)) clearTimeout(t);
    };
  }, [showToastFor]);

  // 去除基于存储状态的首次弹窗，统一以“插件检查 + 事件”驱动，避免重复触发

  // 订阅可用性事件：当后台检查发现新版本时弹出。
  // 优先使用事件 detail 中的版本，避免重复调用插件。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    console.log('[StartupUpdateToast] attach UPDATE_AVAILABILITY_EVENT listener');
    const handler = async (ev: Event) => {
      const { detail } = ev as CustomEvent<UpdateAvailability>;
      const versionFromEvent = detail?.version;
      if (versionFromEvent === UNKNOWN_UPDATE_VERSION) {
        console.warn('[StartupUpdateToast] UPDATE_AVAILABILITY_EVENT without explicit version; will still show');
      }
      if (versionFromEvent) {
        await showToastFor(versionFromEvent, detail.body);
        return;
      }
      // 兼容无 detail 的情况，回退到查询一次
      const info = await getUpdateAvailability();
      console.log('[StartupUpdateToast] event fallback getUpdateAvailability:', info);
      if (info.available && info.version) await showToastFor(info.version, info.body);
    };
    window.addEventListener(UPDATE_AVAILABILITY_EVENT, handler as EventListener);
    return () => window.removeEventListener(UPDATE_AVAILABILITY_EVENT, handler as EventListener);
  }, [showToastFor]);

  return null;
}

async function openReleases() {
  const ok = await linkOpener.openReleases();
  if (!ok) toast.error(translate(useLocaleStore.getState().locale, 'update.releasePageFailed'));
}

function UpdateAvailableNotice({ version, body, onlyCheck, onDismiss }: {
  version: string;
  body?: string;
  onlyCheck: boolean;
  onDismiss: () => void;
}) {
  const t = useTranslation();
  return (
    <div className="flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold">
          {version === UNKNOWN_UPDATE_VERSION
            ? t('update.available')
            : t('update.availableVersion').replace('{0}', () => version)}
        </div>
        <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-1">{t('update.recommendation')}</div>
        <UpdateNotesPreview body={body} />
        <div className="flex items-center flex-wrap gap-3 mt-2">
          <DownloadButton onlyCheck={onlyCheck} />
          <Button size="sm" variant="link" onClick={openReleases} className="h-7 px-2 text-[12px]">
            {t('update.viewReleases')}
          </Button>
          <label className="inline-flex items-center gap-2 text-[12px] text-slate-600 dark:text-slate-300 select-none cursor-pointer">
            <IgnoreCheckbox version={version} onIgnored={onDismiss} />
            {t('update.ignoreVersion')}
          </label>
        </div>
      </div>
      <button
        onClick={onDismiss}
        className="ml-2 -mt-1 text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-200 transition-colors text-[12px]"
        aria-label={t('common.close')}
      >×</button>
    </div>
  );
}

function UpdateFailedNotice({ offline, onRetry }: { offline: boolean; onRetry: () => void }) {
  const t = useTranslation();
  return (
    <div className="flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold">{t('update.downloadFailed')}</div>
        <div className="text-[12px] text-slate-600 dark:text-slate-300 mt-1">
          {t(offline ? 'update.offline' : 'update.downloadHelp')}
        </div>
        <div className="flex items-center gap-3 mt-2">
          <Button size="sm" variant="dialogPrimary" onClick={onRetry} className="h-7 px-3 text-[12px]">
            {t('error.retry')}
          </Button>
          <Button
            size="sm"
            variant="dialogSecondary"
            onClick={async () => { try { const { relaunch } = await import('@tauri-apps/plugin-process'); relaunch(); } catch { /* noop */ } }}
            className="h-7 px-3 text-[12px]"
          >{t('update.restart')}</Button>
          <Button size="sm" variant="link" onClick={openReleases} className="h-7 px-3 text-[12px]">
            {t('update.viewReleases')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DownloadButton({ onlyCheck }: { onlyCheck: boolean }) {
  const t = useTranslation();
  const [loading, setLoading] = useState(false);

  const handleDownload = useCallback(async () => {
    try {
      setLoading(true);
      if (onlyCheck) {
        // 仅检查模式：跳转到发布页
        await openReleases();
        return;
      }

      // 使用 Tauri Updater 下载并安装
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check({ timeout: 30_000 });
      if (!update || !(update as any).available) {
        toast.success(translate(useLocaleStore.getState().locale, 'update.upToDate'));
        return;
      }
      if ('downloadAndInstall' in update && typeof (update as any).downloadAndInstall === 'function') {
        await (update as any).downloadAndInstall();
        // 不再清理持久化的“可用版本”（已移除该存储）
        toast.success(translate(useLocaleStore.getState().locale, 'update.installed'));
        const { relaunch } = await import('@tauri-apps/plugin-process');
        relaunch();
      } else {
        // 兼容兜底
        await openReleases();
      }
    } catch (error) {
      console.error('下载或安装更新失败:', error);
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      toast.raw(<UpdateFailedNotice offline={offline} onRetry={handleDownload} />, { duration: 20000 });
    } finally {
      setLoading(false);
    }
  }, [onlyCheck]);

  return (
    <Button size="sm" variant="dialogPrimary" onClick={handleDownload} disabled={loading} className="h-7 px-3 text-[12px]">
      {t(loading ? 'update.downloading' : 'update.download')}
    </Button>
  );
}

function IgnoreCheckbox({ version, onIgnored }: { version: string; onIgnored?: () => void }) {
  const [checked, setChecked] = useState(false);

  const onChange = useCallback(async (next: boolean | string) => {
    const c = Boolean(next);
    setChecked(c);
    if (c) {
      try {
        await setIgnoredVersion(version);
        onIgnored?.();
      } catch {
        // ignore
      }
    }
  }, [version, onIgnored]);

  return (
    <Checkbox checked={checked} onCheckedChange={onChange} />
  );
}

export default StartupUpdateToast;


